import { v } from 'convex/values'
import * as z from 'zod'

import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server'
import type { ActionCtx } from './_generated/server'
import { internal } from './_generated/api'
import { getUserSettings, requireUserId } from './lib'

/**
 * One-way push: Life OS task ▸ Google Calendar, for personal tasks only.
 *
 * The Google call lives here, on the server, for one reason: the access token.
 * Clerk does not hand a provider token to the browser, so the previous
 * client-side version guessed — it asked for three different JWT template
 * names and, if one came back JWT-shaped, forwarded it to googleapis.com
 * anyway. That sent our own session token to a third party whenever the Clerk
 * template was misconfigured. Here the token is fetched from Clerk's backend
 * API with the deployment's secret key, used, and dropped. It never exists in
 * the browser at all.
 *
 * A shared task is refused. Its `userId` is whoever created it, so the token,
 * the settings and the event would belong to a different account than the one
 * editing. The personal-only rule is enforced here rather than hidden in the
 * client (see `not_personal`).
 *
 * Writes are scheduled by the mutations, never awaited by them: every surface
 * that can change a task's calendar state is a server path, so no call site has
 * to remember. The public `syncTask` exists for an explicit resync.
 */

const GOOGLE_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const GCAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

/** How long a task's calendar block runs. Tasks have a due *moment*, not a
 *  duration, so we give the event a nominal hour. */
const EVENT_MINUTES = 60

/** Google's event-id alphabet: lowercase `a` to `v` plus digits, 5 to 1024
 *  characters. Our ids are uuids, whose hyphens fall outside it. */
const EVENT_ID = /^[a-v0-9]{5,1024}$/

/** The shapes the network hands us. Parsed, never asserted: a cast would be a
 *  compile-time lie about bytes someone else controls. */
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

/** A stable Google event id for a task. This is what makes a retried create
 *  converge instead of duplicating. */
export function derivedEventId(taskId: string): string {
  const id = tryDerivedEventId(taskId)
  if (!id) throw new Error(`Cannot derive a Google event id from "${taskId}"`)
  return id
}

/** Same mapping, for callers that must not fail: a backup can carry an id we
 *  cannot map, and that must not make a delete or a restore impossible. */
export function tryDerivedEventId(taskId: string): string | null {
  const id = taskId.replace(/-/g, '').toLowerCase()
  return EVENT_ID.test(id) ? id : null
}

/** The Google events a personal task owns: the id we recorded, plus the id an
 *  in-flight create would have used. One home for the rule, because tracker,
 *  settings and backup all need it. */
export function eventIdsForTasks(
  tasks: Array<{
    id: string
    spaceId?: string
    calendarEventId?: string | null
    addToCalendar?: boolean
    dueAt: number | null
  }>,
): Array<string> {
  const ids = new Set<string>()
  for (const task of tasks) {
    if (task.spaceId) continue
    const stored = task.calendarEventId ?? null
    if (stored) ids.add(stored)
    if (task.addToCalendar === true && task.dueAt !== null) {
      const derived = tryDerivedEventId(task.id)
      if (derived) ids.add(derived)
    }
  }
  return [...ids]
}

/* ------------------------------------------------------------------ result
 * A closed set of outcomes. The client renders a message per case and never
 * has to interpret an HTTP status — the mapping from Google's failures to
 * "what the user should do about it" happens once, here. */
export type SyncResult =
  | {
      ok: true
      action: 'created' | 'updated' | 'deleted' | 'noop'
      link: string | null
    }
  | {
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

/* -------------------------------------------------------------- internals */

type Snapshot = {
  id: string
  title: string
  notes: string | null
  dueAt: number | null
  reminderMinutes: number
  addToCalendar: boolean
  calendarEventId: string | null
  done: boolean
  archived: boolean
  spaceId: string | null
  syncEnabled: boolean
  timeZone: string | null
}

/** The task's calendar-relevant state, or null when the row is gone. Returning
 *  null rather than throwing is deliberate: a delete that lands between the
 *  schedule and the run is a terminal no-op, not a failed job. */
export const taskForSync = internalQuery({
  args: { userId: v.string(), taskId: v.string() },
  handler: async (ctx, args): Promise<Snapshot | null> => {
    const task = await ctx.db
      .query('tasks')
      .withIndex('by_user_id', (q) =>
        q.eq('userId', args.userId).eq('id', args.taskId),
      )
      .unique()
    if (!task) return null
    const settings = await getUserSettings(ctx, args.userId)
    return {
      id: task.id,
      title: task.title,
      notes: task.notes,
      dueAt: task.dueAt,
      addToCalendar: task.addToCalendar ?? false,
      calendarEventId: task.calendarEventId ?? null,
      reminderMinutes:
        task.reminderMinutes ?? settings?.defaultReminderMinutes ?? 15,
      done: task.done,
      archived: task.archived,
      spaceId: task.spaceId ?? null,
      syncEnabled: settings?.calendarSyncEnabled ?? false,
      timeZone: settings?.timeZone ?? null,
    }
  },
})

/**
 * Record the Google event id, but only if the row still holds the value the
 * caller read. Two things follow from that guard: a delete can never be
 * clobbered by a create that was already in flight, and when the guard fails
 * the event we just made is untracked, so it is deleted rather than leaked.
 */
export const setEventId = internalMutation({
  args: {
    userId: v.string(),
    taskId: v.string(),
    calendarEventId: v.union(v.string(), v.null()),
    expect: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db
      .query('tasks')
      .withIndex('by_user_id', (q) =>
        q.eq('userId', args.userId).eq('id', args.taskId),
      )
      .unique()
    const current = task ? (task.calendarEventId ?? null) : null
    if (task && current === args.expect) {
      await ctx.db.patch(task._id, { calendarEventId: args.calendarEventId })
      return
    }
    // The guard failed, so the event we were about to record is untracked and
    // has to go. Unless it is already the recorded one, which happens when two
    // create attempts converge on the same deterministic id: deleting then
    // would remove an event the caller believes it just created.
    if (args.calendarEventId && args.calendarEventId !== current) {
      await ctx.scheduler.runAfter(0, internal.calendar.deleteEventsForUser, {
        userId: args.userId,
        eventIds: [args.calendarEventId],
      })
    }
  },
})

/**
 * Ask Clerk for this user's Google access token.
 *
 * Clerk renamed the provider slug from `oauth_google` to `google`; which one
 * answers depends on the instance's API version, so we try the current name
 * first and fall back. This is a two-value compatibility shim over a
 * documented endpoint, not the open-ended guessing it replaces.
 *
 * Returns the token plus its granted scopes so the caller can tell "no Google
 * account" apart from "connected, but never granted calendar access" — two
 * problems with two different fixes — and its expiry, so an expired token is
 * reported as needing a reconnect instead of being sent and rejected.
 */
/** Every network call goes through here, so a transport failure is a typed
 *  outcome instead of a throw: the client can render a reason, and a scheduled
 *  run is a result rather than a failed job. */
async function request(
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

/** A body we cannot parse is not fatal, it is unusable: the caller treats it as
 *  "no fields known" rather than guessing at a shape. */
async function readEvent(response: Response) {
  try {
    const parsed = googleEvent.safeParse(await response.json())
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

async function googleAccessToken(clerkUserId: string): Promise<
  | { ok: true; token: string; scopes: Array<string> }
  | {
      ok: false
      reason: 'not_configured' | 'not_connected' | 'reauth_required'
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
    if (!res.ok) continue

    // Clerk returns a bare array on older API versions and a paginated
    // `{ data }` envelope on newer ones; both are parsed, never asserted.
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

/** An IANA name the runtime cannot use would throw out of `formatToParts`, so
 *  it is rejected up front and reported as a fixable state instead. */
function zoneIsUsable(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

/** The local wall clock in `timeZone`, without an offset. Google reads an
 *  offset-bearing timestamp as a fixed instant, so the wall clock has to be
 *  built here in the zone the user actually meant. */
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

/** Google accepts a reminder from 0 to 40320 minutes before the start. */
function clampReminder(minutes: number): number {
  return Math.max(0, Math.min(40320, Math.round(minutes)))
}

function eventBody(snapshot: Snapshot, timeZone: string) {
  const dueAt = snapshot.dueAt!
  return {
    summary: snapshot.title,
    description: snapshot.notes ?? '',
    start: { dateTime: wallClock(dueAt, timeZone), timeZone },
    end: {
      dateTime: wallClock(dueAt + EVENT_MINUTES * 60 * 1000, timeZone),
      timeZone,
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: clampReminder(snapshot.reminderMinutes) },
      ],
    },
    extendedProperties: { private: { lifeosTaskId: snapshot.id } },
  }
}

/** What a push depends on. Compared after the request to catch an edit that
 *  landed while the request was in flight. */
function contentKey(snapshot: Snapshot): string {
  return JSON.stringify([
    snapshot.title,
    snapshot.notes,
    snapshot.dueAt,
    snapshot.reminderMinutes,
    snapshot.addToCalendar,
    snapshot.done,
    snapshot.archived,
  ])
}

function wantsEvent(snapshot: Snapshot): boolean {
  return (
    snapshot.syncEnabled &&
    snapshot.addToCalendar &&
    snapshot.dueAt !== null &&
    !snapshot.done &&
    !snapshot.archived
  )
}

function transportOutcome(detail: string): SyncResult {
  return {
    ok: false,
    reason: 'google_error',
    detail: `Could not reach Google: ${detail}`,
  }
}

function statusOutcome(status: number, doing: string): SyncResult {
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

/** One convergent pass. Google is made to match the task, or told why it could
 *  not be. `pushed` is the snapshot the pass acted on, so the caller can detect
 *  a mid-flight edit. */
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
    // A 404 counts as success: Google has already lost the event, which is
    // the state we were trying to reach. A 410 is the tombstone of a delete
    // that already happened.
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
    // The snapshot comes back so the re-read still runs: an un-done that lands
    // mid-delete has to be able to win.
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

  // `status: confirmed` matters on the patch: Google keeps a deleted event's id
  // reserved, so a create after a delete collides with the tombstone and the
  // confirming patch is the only thing that brings the event back.
  const body = JSON.stringify({
    ...eventBody(snapshot, timeZone),
    status: 'confirmed' as const,
  })

  // A 404 or 410 on patch, or a patch that comes back cancelled, means the
  // event is gone: the user deleted it on the Google side. Honour that, clear
  // the local id, and let an explicit resync be the thing that recreates it.
  const dropRemovedEvent = async (
    expect: string | null,
  ): Promise<{ result: SyncResult; pushed: Snapshot | null }> => {
    await ctx.runMutation(internal.calendar.setEventId, {
      userId,
      taskId,
      calendarEventId: null,
      expect,
    })
    return {
      result: {
        ok: false,
        reason: 'event_removed',
        detail:
          'The calendar event was removed in Google. Use Resync calendar to put it back.',
      },
      pushed: null,
    }
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

  // Create with the deterministic id. A 409 means the id is still reserved by a
  // soft-deleted event, so the create is converged with a confirming patch
  // rather than reported as a failure.
  // An id we cannot map into Google's alphabet is a task we cannot sync. A
  // backup file can carry one, so this is an outcome, not a throw.
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

/**
 * Converge one task. Two passes at most: if an edit lands while the Google
 * request is in flight, the second pass carries the newer state, so the last
 * write is the last edit rather than whichever request finished last.
 */
async function runSync(
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
  // The second pass exists to carry the newer state, so its failure is the
  // result. A second pass that found nothing to do is not an outcome worth
  // replacing the first one with.
  if (!second.result.ok) return second.result
  if (second.result.action === 'noop') return first.result
  return second.result
}

/* ------------------------------------------------------------------ public */

/** Explicit push for the signed-in user, awaited by the Resync control. */
export const syncTask = action({
  args: { taskId: v.string() },
  handler: async (ctx, args): Promise<SyncResult> => {
    const userId = await requireUserId(ctx)
    return await runSync(ctx, userId, args.taskId)
  },
})

/** The scheduler's entry point. Scheduled functions carry no identity, which is
 *  why the owning user is passed explicitly by the mutation that scheduled it. */
export const syncTaskForUser = internalAction({
  args: { userId: v.string(), taskId: v.string() },
  handler: async (ctx, args): Promise<SyncResult> => {
    return await runSync(ctx, args.userId, args.taskId)
  },
})

/** Best-effort deletion of events whose task is gone. A 404 or a 410 means the
 *  event is already gone, which is the state we wanted. */
export const deleteEventsForUser = internalAction({
  args: { userId: v.string(), eventIds: v.array(v.string()) },
  handler: async (_ctx, args) => {
    if (args.eventIds.length === 0) return
    const auth = await googleAccessToken(args.userId)
    if (!auth.ok) return
    if (!auth.scopes.includes(GOOGLE_EVENTS_SCOPE)) return
    const headers = { Authorization: `Bearer ${auth.token}` }
    for (const eventId of args.eventIds) {
      // Best effort: one unreachable delete must not stop the rest.
      await request(`${GCAL}/${eventId}`, { method: 'DELETE', headers })
    }
  },
})
