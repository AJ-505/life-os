import { v } from 'convex/values'
import type { Infer } from 'convex/values'
import * as z from 'zod'

import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from './_generated/server'
import type { ActionCtx, MutationCtx } from './_generated/server'
import { internal } from './_generated/api'
import { getUserSettings, requireUserId, taskByAppId } from './lib'

export const GOOGLE_EVENTS_SCOPE =
  'https://www.googleapis.com/auth/calendar.events'
const GCAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

const DEFAULT_EVENT_MINUTES = 60

const RATE_LIMIT_RETRIES = 3
const RATE_LIMIT_BACKOFF_MS = 30_000

const EVENT_ID = /^[a-v0-9]{5,1024}$/

const clerkTokenEntry = z.object({
  token: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  expires_at: z.number().optional(),
  expiration: z.number().optional(),
})
const clerkTokenBody = z.union([
  z.array(clerkTokenEntry),
  z.object({ data: z.array(clerkTokenEntry).optional() }),
])
const googleEvent = z.object({
  id: z.string().optional(),
  htmlLink: z.string().optional(),
  status: z.string().optional(),
})

export function tryDerivedEventId(taskId: string): string | null {
  const id = taskId.replace(/-/g, '').toLowerCase()
  return EVENT_ID.test(id) ? id : null
}

export function eventsToDelete(
  tasks: Array<{
    id: string
    spaceId?: string | null
    calendarEventId?: string | null
    addToCalendar?: boolean
    dueAt: number | null
  }>,
): Array<EventToDelete> {
  const byEventId = new Map<string, EventToDelete>()
  for (const task of tasks) {
    if (task.spaceId) continue
    const stored = task.calendarEventId ?? null
    if (stored) byEventId.set(stored, { taskId: task.id, eventId: stored })
    if (task.addToCalendar === true && task.dueAt !== null) {
      const derived = tryDerivedEventId(task.id)
      if (derived && !byEventId.has(derived)) {
        byEventId.set(derived, { taskId: task.id, eventId: derived })
      }
    }
  }
  return [...byEventId.values()]
}

export type SyncResult =
  | {
      ok: true
      action: 'created' | 'updated' | 'deleted' | 'noop'
      link: string | null
    }
  | SyncFailure

export type SyncFailure = {
  ok: false
  reason:
    | 'not_configured'
    | 'not_connected'
    | 'reauth_required'
    | 'missing_scope'
    | 'no_timezone'
    | 'not_personal'
    | 'event_removed'
    | 'rate_limited'
    | 'google_error'
  detail: string
}

type SyncIssue = Extract<SyncResult, { ok: false }>['reason']

const syncIssue = v.union(
  v.literal('not_configured'),
  v.literal('not_connected'),
  v.literal('reauth_required'),
  v.literal('missing_scope'),
  v.literal('no_timezone'),
  v.literal('not_personal'),
  v.literal('event_removed'),
  v.literal('rate_limited'),
  v.literal('google_error'),
)

type Snapshot = {
  id: string
  title: string
  notes: string | null
  dueAt: number | null
  durationMinutes: number | null
  reminderMinutes: number
  addToCalendar: boolean
  autoAdd: boolean
  calendarEventId: string | null
  syncIssue: SyncIssue | null
  done: boolean
  archived: boolean
  spaceId: string | null
  syncEnabled: boolean
  timeZone: string | null
}

const eventToDelete = v.object({
  taskId: v.string(),
  eventId: v.string(),
})
type EventToDelete = Infer<typeof eventToDelete>

export const taskForSync = internalQuery({
  args: { userId: v.string(), taskId: v.string() },
  handler: async (ctx, args): Promise<Snapshot | null> => {
    const task = await taskByAppId(ctx, args.userId, args.taskId)
    if (!task) return null
    const settings = await getUserSettings(ctx, args.userId)
    return {
      id: task.id,
      title: task.title,
      notes: task.notes,
      dueAt: task.dueAt,
      durationMinutes: task.durationMinutes ?? null,
      addToCalendar: task.addToCalendar ?? false,
      autoAdd: settings?.autoAddToCalendar ?? false,
      calendarEventId: task.calendarEventId ?? null,
      reminderMinutes:
        task.reminderMinutes ?? settings?.defaultReminderMinutes ?? 15,
      done: task.done,
      archived: task.archived,
      spaceId: task.spaceId ?? null,
      syncEnabled: settings?.calendarSyncEnabled ?? false,
      syncIssue: task.calendarSyncIssue ?? null,
      timeZone: settings?.timeZone ?? null,
    }
  },
})

async function applyEventId(
  ctx: MutationCtx,
  args: {
    userId: string
    taskId: string
    calendarEventId: string | null
    expect: string | null
  },
) {
  const task = await taskByAppId(ctx, args.userId, args.taskId)
  const current = task ? (task.calendarEventId ?? null) : null
  if (task && current === args.expect) {
    await ctx.db.patch(task._id, { calendarEventId: args.calendarEventId })
    return
  }
  if (args.calendarEventId && args.calendarEventId !== current) {
    await ctx.scheduler.runAfter(0, internal.calendar.deleteEventsForUser, {
      userId: args.userId,
      events: [{ taskId: args.taskId, eventId: args.calendarEventId }],
    })
  }
}

export const setEventId = internalMutation({
  args: {
    userId: v.string(),
    taskId: v.string(),
    calendarEventId: v.union(v.string(), v.null()),
    expect: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    await applyEventId(ctx, args)
  },
})

export async function request(
  url: string,
  init: RequestInit,
): Promise<{ ok: true; response: Response } | { ok: false; detail: string }> {
  try {
    return { ok: true, response: await fetch(url, init) }
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

async function readEvent(response: Response) {
  try {
    const parsed = googleEvent.safeParse(await response.json())
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

function clerkRefusal(status: number) {
  if (status === 401 || status === 403)
    return {
      ok: false as const,
      reason: 'not_configured' as const,
      detail: `Clerk rejected this deployment's API key with ${status}. CLERK_SECRET_KEY is wrong or lacks permission. The user cannot fix this.`,
    }
  if (status === 429)
    return {
      ok: false as const,
      reason: 'rate_limited' as const,
      detail: 'Clerk is rate limiting us. Try again in a minute.',
    }
  if (status >= 500)
    return {
      ok: false as const,
      reason: 'google_error' as const,
      detail: `Clerk returned ${status} while fetching the Google token.`,
    }
  return null
}

export async function googleAccessToken(clerkUserId: string): Promise<
  | { ok: true; token: string; scopes: Array<string> }
  | {
      ok: false
      reason:
        | 'not_configured'
        | 'not_connected'
        | 'reauth_required'
        | 'rate_limited'
        | 'google_error'
      detail: string
    }
> {
  const secret = process.env.CLERK_SECRET_KEY
  if (!secret) {
    return {
      ok: false,
      reason: 'not_configured',
      detail:
        'CLERK_SECRET_KEY is not set on the Convex deployment. Run: npx convex env set CLERK_SECRET_KEY sk_...',
    }
  }

  for (const provider of ['google', 'oauth_google']) {
    const attempt = await request(
      `https://api.clerk.com/v1/users/${clerkUserId}/oauth_access_tokens/${provider}`,
      { headers: { Authorization: `Bearer ${secret}` } },
    )
    if (!attempt.ok) continue
    const res = attempt.response
    const refused = clerkRefusal(res.status)
    if (refused) return refused
    if (!res.ok) continue

    let raw: unknown
    try {
      raw = await res.json()
    } catch {
      continue
    }
    const parsed = clerkTokenBody.safeParse(raw)
    if (!parsed.success) continue
    const entries = Array.isArray(parsed.data)
      ? parsed.data
      : (parsed.data.data ?? [])
    const entry = entries.find((e) => typeof e.token === 'string')
    if (entry?.token) {
      const expirySeconds = entry.expires_at ?? entry.expiration
      if (
        typeof expirySeconds === 'number' &&
        expirySeconds * 1000 <= Date.now()
      ) {
        return {
          ok: false,
          reason: 'reauth_required',
          detail:
            'The Google connection has expired. Reconnect it in Settings.',
        }
      }
      return {
        ok: true,
        token: entry.token,
        scopes: entry.scopes ?? [],
      }
    }
  }

  return {
    ok: false,
    reason: 'not_connected',
    detail: 'No Google account is connected to this Clerk user.',
  }
}

function zoneIsUsable(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

function wallClock(epochMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochMs))
  const at = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '00'
  return `${at('year')}-${at('month')}-${at('day')}T${at('hour')}:${at('minute')}:${at('second')}`
}

function clampReminder(minutes: number): number {
  return Math.max(0, Math.min(40320, Math.round(minutes)))
}

function nextDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
}

export function eventTimes(
  dueAt: number,
  timeZone: string,
  durationMinutes: number | null = null,
) {
  const start = wallClock(dueAt, timeZone)
  const date = start.slice(0, 10)
  if (start.endsWith('T00:00:00'))
    return {
      start: { date, dateTime: null, timeZone },
      end: { date: nextDay(date), dateTime: null, timeZone },
    }
  const endAt = dueAt + (durationMinutes ?? DEFAULT_EVENT_MINUTES) * 60 * 1000
  return {
    start: {
      date: null,
      dateTime: `${start}${utcOffset(dueAt, timeZone)}`,
      timeZone,
    },
    end: {
      date: null,
      dateTime: `${wallClock(endAt, timeZone)}${utcOffset(endAt, timeZone)}`,
      timeZone,
    },
  }
}

function utcOffset(epochMs: number, timeZone: string): string {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(new Date(epochMs))
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT'
  return name === 'GMT' ? '+00:00' : name.slice(3)
}

function eventBody(snapshot: Snapshot, timeZone: string) {
  return {
    summary: snapshot.title,
    description: snapshot.notes ?? '',
    ...eventTimes(snapshot.dueAt!, timeZone, snapshot.durationMinutes),
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: clampReminder(snapshot.reminderMinutes) },
      ],
    },
    extendedProperties: { private: { lifeosTaskId: snapshot.id } },
  }
}

function contentKey(snapshot: Snapshot): string {
  return JSON.stringify([
    snapshot.title,
    snapshot.notes,
    snapshot.dueAt,
    snapshot.durationMinutes,
    snapshot.reminderMinutes,
    snapshot.addToCalendar,
    snapshot.autoAdd,
    snapshot.done,
    snapshot.archived,
  ])
}

export function taskWantsEvent(
  task: {
    addToCalendar?: boolean
    dueAt: number | null
    done: boolean
    archived: boolean
    spaceId?: string | null
    importedFromEventId?: string | null
  },
  settings: { syncEnabled: boolean; autoAdd: boolean },
): boolean {
  return (
    settings.syncEnabled &&
    !task.spaceId &&
    (task.importedFromEventId ?? null) === null &&
    (task.addToCalendar === true || settings.autoAdd) &&
    task.dueAt !== null &&
    !task.done &&
    !task.archived
  )
}

function wantsEvent(snapshot: Snapshot): boolean {
  return taskWantsEvent(snapshot, snapshot)
}

export function transportOutcome(detail: string): SyncFailure {
  return {
    ok: false,
    reason: 'google_error',
    detail: `Could not reach Google: ${detail}`,
  }
}

export function statusOutcome(status: number, doing: string): SyncFailure {
  if (status === 401)
    return {
      ok: false,
      reason: 'reauth_required',
      detail: 'Google rejected the connection. Reconnect it in Settings.',
    }
  if (status === 403)
    return {
      ok: false,
      reason: 'missing_scope',
      detail: `Google refused ${doing} for lack of calendar permission.`,
    }
  if (status === 429)
    return {
      ok: false,
      reason: 'rate_limited',
      detail: 'Google is rate limiting us. Try again in a minute.',
    }
  return {
    ok: false,
    reason: 'google_error',
    detail: `Google returned ${status} ${doing}.`,
  }
}

const removedResult: SyncResult = {
  ok: false,
  reason: 'event_removed',
  detail:
    'The calendar event was removed in Google. Use Repair calendar in Settings to bring it back.',
}

export const setSyncIssue = internalMutation({
  args: {
    userId: v.string(),
    taskId: v.string(),
    issue: v.union(syncIssue, v.null()),
  },
  handler: async (ctx, args) => {
    const task = await taskByAppId(ctx, args.userId, args.taskId)
    if (!task || (task.calendarSyncIssue ?? null) === args.issue) return
    await ctx.db.patch(task._id, { calendarSyncIssue: args.issue ?? undefined })
  },
})

async function pushOnce(
  ctx: ActionCtx,
  userId: string,
  taskId: string,
): Promise<{ result: SyncResult; pushed: Snapshot | null }> {
  const snapshot = await ctx.runQuery(internal.calendar.taskForSync, {
    userId,
    taskId,
  })
  if (!snapshot)
    return { result: { ok: true, action: 'noop', link: null }, pushed: null }
  if (snapshot.spaceId !== null)
    return {
      result: {
        ok: false,
        reason: 'not_personal',
        detail: 'Calendar sync is personal only. Shared tasks are not synced.',
      },
      pushed: null,
    }

  const wants = wantsEvent(snapshot)
  const has = snapshot.calendarEventId !== null
  if (!wants && !has)
    return { result: { ok: true, action: 'noop', link: null }, pushed: null }
  if (wants && !has && snapshot.syncIssue === 'event_removed')
    return { result: removedResult, pushed: null }

  const auth = await googleAccessToken(userId)
  if (!auth.ok)
    return {
      result: { ok: false, reason: auth.reason, detail: auth.detail },
      pushed: null,
    }
  if (!auth.scopes.includes(GOOGLE_EVENTS_SCOPE))
    return {
      result: {
        ok: false,
        reason: 'missing_scope',
        detail: `The connected Google account has not granted ${GOOGLE_EVENTS_SCOPE}.`,
      },
      pushed: null,
    }
  const headers = {
    Authorization: `Bearer ${auth.token}`,
    'Content-Type': 'application/json',
  }

  if (!wants) {
    const attempt = await request(`${GCAL}/${snapshot.calendarEventId}`, {
      method: 'DELETE',
      headers,
    })
    if (!attempt.ok)
      return { result: transportOutcome(attempt.detail), pushed: null }
    const res = attempt.response
    if (!res.ok && res.status !== 404 && res.status !== 410)
      return {
        result: statusOutcome(res.status, 'deleting the event'),
        pushed: null,
      }
    await ctx.runMutation(internal.calendar.setEventId, {
      userId,
      taskId,
      calendarEventId: null,
      expect: snapshot.calendarEventId,
    })
    return {
      result: { ok: true, action: 'deleted', link: null },
      pushed: snapshot,
    }
  }

  const timeZone = snapshot.timeZone
  if (!timeZone || !zoneIsUsable(timeZone))
    return {
      result: {
        ok: false,
        reason: 'no_timezone',
        detail:
          'Life OS does not know your timezone yet, so it will not guess. Reopen the app once, then try again.',
      },
      pushed: null,
    }

  const body = JSON.stringify({
    ...eventBody(snapshot, timeZone),
    status: 'confirmed' as const,
  })

  const dropRemovedEvent = async (
    expect: string | null,
  ): Promise<{ result: SyncResult; pushed: Snapshot | null }> => {
    await ctx.runMutation(internal.calendar.setEventId, {
      userId,
      taskId,
      calendarEventId: null,
      expect,
    })
    return { result: removedResult, pushed: null }
  }

  const patchEvent = async (
    eventId: string,
    expect: string | null,
  ): Promise<{ result: SyncResult; pushed: Snapshot | null }> => {
    const attempt = await request(`${GCAL}/${eventId}`, {
      method: 'PATCH',
      headers,
      body,
    })
    if (!attempt.ok)
      return { result: transportOutcome(attempt.detail), pushed: null }
    const res = attempt.response
    if (res.status === 404 || res.status === 410)
      return await dropRemovedEvent(expect)
    if (!res.ok)
      return {
        result: statusOutcome(res.status, 'writing the event'),
        pushed: null,
      }
    const existing = await readEvent(res)
    if (existing.status === 'cancelled') return await dropRemovedEvent(expect)
    if (existing.id && existing.id !== snapshot.calendarEventId) {
      await ctx.runMutation(internal.calendar.setEventId, {
        userId,
        taskId,
        calendarEventId: existing.id,
        expect: snapshot.calendarEventId,
      })
    }
    return {
      result: {
        ok: true,
        action: 'updated',
        link: existing.htmlLink ?? null,
      },
      pushed: snapshot,
    }
  }

  if (has)
    return await patchEvent(snapshot.calendarEventId!, snapshot.calendarEventId)

  const eventId = tryDerivedEventId(taskId)
  if (!eventId)
    return {
      result: {
        ok: false,
        reason: 'google_error',
        detail:
          'This task id cannot be turned into a calendar event id, so it cannot be synced.',
      },
      pushed: null,
    }

  const attempt = await request(GCAL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...JSON.parse(body), id: eventId }),
  })
  if (!attempt.ok)
    return { result: transportOutcome(attempt.detail), pushed: null }
  const res = attempt.response
  if (res.status === 409) return await patchEvent(eventId, null)
  if (!res.ok)
    return {
      result: statusOutcome(res.status, 'creating the event'),
      pushed: null,
    }
  const created = await readEvent(res)
  if (created.id) {
    await ctx.runMutation(internal.calendar.setEventId, {
      userId,
      taskId,
      calendarEventId: created.id,
      expect: null,
    })
  }
  return {
    result: { ok: true, action: 'created', link: created.htmlLink ?? null },
    pushed: snapshot,
  }
}

async function runSync(
  ctx: ActionCtx,
  userId: string,
  taskId: string,
): Promise<SyncResult> {
  const result = await converge(ctx, userId, taskId)
  await ctx.runMutation(internal.calendar.setSyncIssue, {
    userId,
    taskId,
    issue: result.ok ? null : result.reason,
  })
  return result
}

async function converge(
  ctx: ActionCtx,
  userId: string,
  taskId: string,
): Promise<SyncResult> {
  const first = await pushOnce(ctx, userId, taskId)
  if (!first.pushed) return first.result

  const fresh = await ctx.runQuery(internal.calendar.taskForSync, {
    userId,
    taskId,
  })
  if (!fresh || contentKey(fresh) === contentKey(first.pushed))
    return first.result

  const second = await pushOnce(ctx, userId, taskId)
  if (!second.result.ok) return second.result
  if (second.result.action === 'noop') return first.result
  return second.result
}

export const syncTask = action({
  args: { taskId: v.string() },
  handler: async (ctx, args): Promise<SyncResult> => {
    const userId = await requireUserId(ctx)
    const snapshot = await ctx.runQuery(internal.calendar.taskForSync, {
      userId,
      taskId: args.taskId,
    })
    const stale =
      snapshot &&
      wantsEvent(snapshot) &&
      snapshot.calendarEventId === tryDerivedEventId(args.taskId)
        ? snapshot.calendarEventId
        : null
    if (stale) {
      await ctx.runMutation(internal.calendar.setEventId, {
        userId,
        taskId: args.taskId,
        calendarEventId: null,
        expect: stale,
      })
    }
    if (snapshot?.syncIssue === 'event_removed') {
      await ctx.runMutation(internal.calendar.setSyncIssue, {
        userId,
        taskId: args.taskId,
        issue: null,
      })
    }
    return await runSync(ctx, userId, args.taskId)
  },
})

export const syncTaskForUser = internalAction({
  args: {
    userId: v.string(),
    taskId: v.string(),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SyncResult> => {
    const result = await runSync(ctx, args.userId, args.taskId)
    const attempt = args.attempt
    if (
      attempt !== undefined &&
      attempt < RATE_LIMIT_RETRIES &&
      !result.ok &&
      result.reason === 'rate_limited'
    ) {
      await ctx.scheduler.runAfter(
        RATE_LIMIT_BACKOFF_MS * 2 ** attempt,
        internal.calendar.syncTaskForUser,
        { userId: args.userId, taskId: args.taskId, attempt: attempt + 1 },
      )
    }
    return result
  },
})

const ACCESS_ISSUES = [
  'not_connected',
  'reauth_required',
  'missing_scope',
] as const satisfies ReadonlyArray<SyncIssue>

const ACCESS_RETRY_LIMIT = 200
const ACCESS_RETRY_SPACING_MS = 250

export const retryAccessIssues = mutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    const userId = await requireUserId(ctx)
    let queued = 0
    for (const issue of ACCESS_ISSUES) {
      const stuck = await ctx.db
        .query('tasks')
        .withIndex('by_user_sync_issue', (q) =>
          q.eq('userId', userId).eq('calendarSyncIssue', issue),
        )
        .take(ACCESS_RETRY_LIMIT - queued)
      for (const task of stuck) {
        await ctx.scheduler.runAfter(
          queued * ACCESS_RETRY_SPACING_MS,
          internal.calendar.syncTaskForUser,
          { userId, taskId: task.id, attempt: 0 },
        )
        queued += 1
      }
      if (queued >= ACCESS_RETRY_LIMIT) break
    }
    return queued
  },
})

export const deleteEventsForUser = internalAction({
  args: { userId: v.string(), events: v.array(eventToDelete) },
  handler: async (ctx, args) => {
    if (args.events.length === 0) return
    const auth = await googleAccessToken(args.userId)
    if (!auth.ok) return
    if (!auth.scopes.includes(GOOGLE_EVENTS_SCOPE)) return
    const headers = { Authorization: `Bearer ${auth.token}` }
    const gone: Array<EventToDelete> = []
    for (const event of args.events) {
      const sent = await request(`${GCAL}/${event.eventId}`, {
        method: 'DELETE',
        headers,
      })
      if (!sent.ok) continue
      const { status } = sent.response
      if (sent.response.ok || status === 404 || status === 410) {
        gone.push(event)
      }
    }
    if (gone.length === 0) return
    await ctx.runMutation(internal.calendar.clearEventIds, {
      userId: args.userId,
      events: gone,
    })
  },
})

export const clearEventIds = internalMutation({
  args: { userId: v.string(), events: v.array(eventToDelete) },
  handler: async (ctx, args) => {
    const settings = await getUserSettings(ctx, args.userId)
    const rule = {
      syncEnabled: settings?.calendarSyncEnabled ?? false,
      autoAdd: settings?.autoAddToCalendar ?? false,
    }
    for (const event of args.events) {
      await applyEventId(ctx, {
        userId: args.userId,
        taskId: event.taskId,
        calendarEventId: null,
        expect: event.eventId,
      })
      const task = await taskByAppId(ctx, args.userId, event.taskId)
      if (!task) continue
      if (!taskWantsEvent(task, rule)) {
        if (task.calendarSyncIssue === 'event_removed') {
          await ctx.db.patch(task._id, { calendarSyncIssue: undefined })
        }
        continue
      }
      if (
        (task.calendarEventId ?? null) === null &&
        task.calendarSyncIssue !== 'event_removed'
      ) {
        await ctx.scheduler.runAfter(0, internal.calendar.syncTaskForUser, {
          userId: args.userId,
          taskId: task.id,
        })
      }
    }
  },
})
