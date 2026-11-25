import { v } from 'convex/values'

import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from './_generated/server'
import { internal } from './_generated/api'
import { ownTask, requireUserId } from './access'
import { eventToDelete, readUserSettings, schedulePush } from './calendarSync'
import {
  DEFAULT_REMINDER_MINUTES,
  derivedEventId,
  syncRule,
  taskHasEvent,
  taskWantsEvent,
} from './syncRule'
import { openGoogleCalendar } from './googleCalendar'
import { DEFAULT_EVENT_MINUTES, syncIssue } from './taskModel'
import { nextDate, usableTimeZone, utcOffset, wallClock } from './zonedTime'

import type { ActionCtx, MutationCtx } from './_generated/server'
import type { EventToDelete } from './calendarSync'
import type { GoogleCalendar, SyncFailure } from './googleCalendar'
import type { SyncIssue } from './taskModel'

export type { SyncFailure } from './googleCalendar'

const RETRIES = 3
const BACKOFF_MS = 30_000

const REPAIR_LIMIT = 2000
const REPAIR_CONCURRENCY = 4

export type SyncResult =
  | {
      ok: true
      action: 'created' | 'updated' | 'deleted' | 'noop'
      link: string | null
    }
  | SyncFailure

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
  importedFromEventId: string | null
  syncEnabled: boolean
  timeZone: string | null
}

type Push = { result: SyncResult; pushed: Snapshot | null }

const NOOP: SyncResult = { ok: true, action: 'noop', link: null }

const REMOVED: SyncFailure = {
  ok: false,
  reason: 'event_removed',
  detail:
    'The calendar event was removed in Google. Use Repair calendar in Settings to bring it back.',
}

const PUSH_RETRIES_ON: ReadonlyArray<SyncIssue> = ['rate_limited']
const REMOVAL_RETRIES_ON: ReadonlyArray<SyncIssue> = [
  'rate_limited',
  'google_error',
]

const shouldRetry = (
  result: SyncResult,
  attempt: number,
  retryOn: ReadonlyArray<SyncIssue>,
) => !result.ok && retryOn.includes(result.reason) && attempt < RETRIES

const backoff = (attempt: number) => BACKOFF_MS * 2 ** attempt

export const taskForSync = internalQuery({
  args: { userId: v.string(), taskId: v.string() },
  handler: async (ctx, args): Promise<Snapshot | null> => {
    const task = await ownTask(ctx, args.userId, args.taskId)
    if (!task) return null
    const settings = await readUserSettings(ctx, args.userId)
    const rule = syncRule(settings)
    return {
      id: task.id,
      title: task.title,
      notes: task.notes,
      dueAt: task.dueAt,
      durationMinutes: task.durationMinutes ?? null,
      addToCalendar: task.addToCalendar ?? false,
      autoAdd: rule.autoAdd,
      calendarEventId: task.calendarEventId ?? null,
      reminderMinutes:
        task.reminderMinutes ??
        settings?.defaultReminderMinutes ??
        DEFAULT_REMINDER_MINUTES,
      done: task.done,
      archived: task.archived,
      spaceId: task.spaceId ?? null,
      importedFromEventId: task.importedFromEventId ?? null,
      syncEnabled: rule.syncEnabled,
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
  const task = await ownTask(ctx, args.userId, args.taskId)
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

export const setSyncIssue = internalMutation({
  args: {
    userId: v.string(),
    taskId: v.string(),
    issue: v.union(syncIssue, v.null()),
  },
  handler: async (ctx, args) => {
    const task = await ownTask(ctx, args.userId, args.taskId)
    if (!task || (task.calendarSyncIssue ?? null) === args.issue) return
    await ctx.db.patch(task._id, { calendarSyncIssue: args.issue ?? undefined })
  },
})

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
      end: { date: nextDate(date), dateTime: null, timeZone },
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

const clampReminder = (minutes: number) =>
  Math.max(0, Math.min(40320, Math.round(minutes)))

function eventBody(snapshot: Snapshot, dueAt: number, timeZone: string) {
  return {
    summary: snapshot.title,
    description: snapshot.notes ?? '',
    ...eventTimes(dueAt, timeZone, snapshot.durationMinutes),
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: clampReminder(snapshot.reminderMinutes) },
      ],
    },
    extendedProperties: { private: { lifeosTaskId: snapshot.id } },
    status: 'confirmed',
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

const wantsEvent = (snapshot: Snapshot) => taskWantsEvent(snapshot, snapshot)

async function recordEventId(
  ctx: ActionCtx,
  userId: string,
  taskId: string,
  calendarEventId: string | null,
  expect: string | null,
) {
  await ctx.runMutation(internal.calendar.setEventId, {
    userId,
    taskId,
    calendarEventId,
    expect,
  })
}

async function writeEvent(
  ctx: ActionCtx,
  userId: string,
  calendar: GoogleCalendar,
  snapshot: Snapshot,
  body: object,
): Promise<Push> {
  const removed = async (expect: string | null): Promise<Push> => {
    await recordEventId(ctx, userId, snapshot.id, null, expect)
    return { result: REMOVED, pushed: null }
  }

  const patch = async (eventId: string, expect: string | null) => {
    const written = await calendar.patch(eventId, body)
    if (written.kind === 'gone') return await removed(expect)
    if (written.kind === 'failed')
      return { result: written.failure, pushed: null }
    if (written.id && written.id !== snapshot.calendarEventId)
      await recordEventId(
        ctx,
        userId,
        snapshot.id,
        written.id,
        snapshot.calendarEventId,
      )
    return {
      result: { ok: true, action: 'updated', link: written.link },
      pushed: snapshot,
    } satisfies Push
  }

  if (snapshot.calendarEventId !== null)
    return await patch(snapshot.calendarEventId, snapshot.calendarEventId)

  const eventId = derivedEventId(snapshot.id)
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

  const created = await calendar.insert(eventId, body)
  if (created.kind === 'conflict') return await patch(eventId, null)
  if (created.kind === 'failed')
    return { result: created.failure, pushed: null }
  if (created.id)
    await recordEventId(ctx, userId, snapshot.id, created.id, null)
  return {
    result: { ok: true, action: 'created', link: created.link },
    pushed: snapshot,
  }
}

async function pushOnce(
  ctx: ActionCtx,
  userId: string,
  taskId: string,
): Promise<Push> {
  const snapshot = await ctx.runQuery(internal.calendar.taskForSync, {
    userId,
    taskId,
  })
  if (!snapshot) return { result: NOOP, pushed: null }
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
  if (!wants && !has) return { result: NOOP, pushed: null }
  if (wants && !has && snapshot.syncIssue === 'event_removed')
    return { result: REMOVED, pushed: null }

  const opened = await openGoogleCalendar(userId)
  if (!opened.ok) return { result: opened, pushed: null }

  if (!wants) {
    const removal = await opened.calendar.remove(snapshot.calendarEventId!)
    if (removal.kind === 'failed')
      return { result: removal.failure, pushed: null }
    await recordEventId(ctx, userId, taskId, null, snapshot.calendarEventId)
    return {
      result: { ok: true, action: 'deleted', link: null },
      pushed: snapshot,
    }
  }

  const timeZone = usableTimeZone(snapshot.timeZone)
  if (!timeZone)
    return {
      result: {
        ok: false,
        reason: 'no_timezone',
        detail:
          'Life OS does not know your timezone yet, so it will not guess. Reopen the app once, then try again.',
      },
      pushed: null,
    }

  const body = eventBody(snapshot, snapshot.dueAt!, timeZone)
  return await writeEvent(ctx, userId, opened.calendar, snapshot, body)
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

async function repairTask(
  ctx: ActionCtx,
  userId: string,
  taskId: string,
): Promise<SyncResult> {
  const snapshot = await ctx.runQuery(internal.calendar.taskForSync, {
    userId,
    taskId,
  })
  const stale =
    snapshot &&
    wantsEvent(snapshot) &&
    snapshot.calendarEventId === derivedEventId(taskId)
      ? snapshot.calendarEventId
      : null
  if (stale) await recordEventId(ctx, userId, taskId, null, stale)
  if (snapshot?.syncIssue === 'event_removed') {
    await ctx.runMutation(internal.calendar.setSyncIssue, {
      userId,
      taskId,
      issue: null,
    })
  }
  return await runSync(ctx, userId, taskId)
}

export const syncTask = action({
  args: { taskId: v.string() },
  handler: async (ctx, args): Promise<SyncResult> => {
    const userId = await requireUserId(ctx)
    return await repairTask(ctx, userId, args.taskId)
  },
})

export const repairTargets = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args): Promise<Array<string>> => {
    const rule = syncRule(await readUserSettings(ctx, args.userId))
    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .take(REPAIR_LIMIT)
    return tasks
      .filter(
        (task) =>
          !task.spaceId && (taskHasEvent(task) || taskWantsEvent(task, rule)),
      )
      .map((task) => task.id)
  },
})

export type RepairSummary = {
  total: number
  updated: number
  failed: number
  reason: SyncIssue | null
}

function summarize(results: Array<SyncResult>): RepairSummary {
  const reasons = new Map<SyncIssue, number>()
  let updated = 0
  for (const result of results) {
    if (result.ok) {
      if (result.action !== 'noop') updated += 1
      continue
    }
    reasons.set(result.reason, (reasons.get(result.reason) ?? 0) + 1)
  }
  const ranked = [...reasons.entries()].sort((a, b) => b[1] - a[1])
  return {
    total: results.length,
    updated,
    failed: results.length - results.filter((result) => result.ok).length,
    reason: ranked[0]?.[0] ?? null,
  }
}

export const repairCalendar = action({
  args: {},
  handler: async (ctx): Promise<RepairSummary> => {
    const userId = await requireUserId(ctx)
    const taskIds = await ctx.runQuery(internal.calendar.repairTargets, {
      userId,
    })
    const results: Array<SyncResult> = []
    let next = 0
    const worker = async () => {
      for (let index = next++; index < taskIds.length; index = next++)
        results[index] = await repairTask(ctx, userId, taskIds[index])
    }
    await Promise.all(Array.from({ length: REPAIR_CONCURRENCY }, worker))
    return summarize(results)
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
    const attempt = args.attempt ?? 0
    if (shouldRetry(result, attempt, PUSH_RETRIES_ON)) {
      await ctx.scheduler.runAfter(
        backoff(attempt),
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
        await schedulePush(
          ctx,
          userId,
          task.id,
          queued * ACCESS_RETRY_SPACING_MS,
        )
        queued += 1
      }
      if (queued >= ACCESS_RETRY_LIMIT) break
    }
    return queued
  },
})

export const deleteEventsForUser = internalAction({
  args: {
    userId: v.string(),
    events: v.array(eventToDelete),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.events.length === 0) return
    const attempt = args.attempt ?? 0
    const opened = await openGoogleCalendar(args.userId)
    const gone: Array<EventToDelete> = []
    const left: Array<EventToDelete> = []
    let failure: SyncFailure | null = opened.ok ? null : opened
    for (const event of args.events) {
      if (!opened.ok) {
        left.push(event)
        continue
      }
      const removal = await opened.calendar.remove(event.eventId)
      if (removal.kind === 'removed') gone.push(event)
      else {
        left.push(event)
        failure = removal.failure
      }
    }
    if (gone.length > 0)
      await ctx.runMutation(internal.calendar.clearEventIds, {
        userId: args.userId,
        events: gone,
      })
    if (left.length === 0 || failure === null) return
    if (shouldRetry(failure, attempt, REMOVAL_RETRIES_ON)) {
      await ctx.scheduler.runAfter(
        backoff(attempt),
        internal.calendar.deleteEventsForUser,
        { userId: args.userId, events: left, attempt: attempt + 1 },
      )
      return
    }
    await ctx.runMutation(internal.calendar.markRemovalFailed, {
      userId: args.userId,
      events: left,
      issue: failure.reason,
    })
  },
})

export const markRemovalFailed = internalMutation({
  args: {
    userId: v.string(),
    events: v.array(eventToDelete),
    issue: syncIssue,
  },
  handler: async (ctx, args) => {
    for (const event of args.events) {
      const task = await ownTask(ctx, args.userId, event.taskId)
      if (!task || (task.calendarEventId ?? null) !== event.eventId) continue
      await ctx.db.patch(task._id, { calendarSyncIssue: args.issue })
    }
  },
})

export const clearEventIds = internalMutation({
  args: { userId: v.string(), events: v.array(eventToDelete) },
  handler: async (ctx, args) => {
    const rule = syncRule(await readUserSettings(ctx, args.userId))
    for (const event of args.events) {
      await applyEventId(ctx, {
        userId: args.userId,
        taskId: event.taskId,
        calendarEventId: null,
        expect: event.eventId,
      })
      const task = await ownTask(ctx, args.userId, event.taskId)
      if (!task) continue
      if (!taskWantsEvent(task, rule)) {
        if (task.calendarSyncIssue)
          await ctx.db.patch(task._id, { calendarSyncIssue: undefined })
        continue
      }
      if (!taskHasEvent(task) && task.calendarSyncIssue !== 'event_removed')
        await schedulePush(ctx, args.userId, task.id)
    }
  },
})
