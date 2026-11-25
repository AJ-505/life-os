import { v } from 'convex/values'

import { internalMutation } from './_generated/server'
import { internal } from './_generated/api'

import {
  eventsToDelete,
  syncRule,
  taskHasEvent,
  taskWantsEvent,
} from './syncRule'

import type { Infer } from 'convex/values'
import type { Doc } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { SyncRule } from './syncRule'

export const eventToDelete = v.object({
  taskId: v.string(),
  eventId: v.string(),
})

export type EventToDelete = Infer<typeof eventToDelete>

const SWEEP_PAGE = 100
const PUSH_STAGGER_MS = 300

const CALENDAR_FIELDS = [
  'dueAt',
  'durationMinutes',
  'reminderMinutes',
  'addToCalendar',
  'done',
  'archived',
  'title',
  'notes',
] as const

export async function readUserSettings(
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<Doc<'userSettings'> | null> {
  return await ctx.db
    .query('userSettings')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first()
}

export async function schedulePush(
  ctx: MutationCtx,
  userId: string,
  taskId: string,
  delayMs = 0,
) {
  await ctx.scheduler.runAfter(delayMs, internal.calendar.syncTaskForUser, {
    userId,
    taskId,
  })
}

export async function scheduleRemoval(
  ctx: MutationCtx,
  userId: string,
  events: Array<EventToDelete>,
) {
  if (events.length === 0) return
  await ctx.scheduler.runAfter(0, internal.calendar.deleteEventsForUser, {
    userId,
    events,
  })
}

export async function afterTaskWrite(
  ctx: MutationCtx,
  userId: string,
  before: Doc<'tasks'> | null,
  after: Doc<'tasks'>,
) {
  const touched =
    before === null ||
    CALENDAR_FIELDS.some(
      (field) => (before[field] ?? null) !== (after[field] ?? null),
    )
  if (!touched) return
  const rule = syncRule(await readUserSettings(ctx, userId))
  if (!taskWantsEvent(after, rule) && !taskHasEvent(after)) return
  await schedulePush(ctx, userId, after.id)
}

export async function afterTasksDeleted(
  ctx: MutationCtx,
  userId: string,
  tasks: Array<Doc<'tasks'>>,
) {
  await scheduleRemoval(ctx, userId, eventsToDelete(tasks))
}

const sweepMode = v.union(
  v.literal('backfill'),
  v.literal('removeAll'),
  v.literal('removeAutoAdded'),
)

type SweepMode = Infer<typeof sweepMode>

async function startSweep(ctx: MutationCtx, userId: string, mode: SweepMode) {
  await ctx.scheduler.runAfter(0, internal.calendarSync.sweep, {
    userId,
    mode,
    cursor: null,
  })
}

export async function afterSettingsChange(
  ctx: MutationCtx,
  userId: string,
  before: SyncRule,
  after: SyncRule,
) {
  if (before.syncEnabled && !after.syncEnabled)
    return await startSweep(ctx, userId, 'removeAll')
  if (!after.syncEnabled) return
  if (!before.syncEnabled || (after.autoAdd && !before.autoAdd))
    return await startSweep(ctx, userId, 'backfill')
  if (before.autoAdd && !after.autoAdd)
    await startSweep(ctx, userId, 'removeAutoAdded')
}

async function backfillPage(
  ctx: MutationCtx,
  userId: string,
  rule: SyncRule,
  page: Array<Doc<'tasks'>>,
): Promise<number> {
  const pending = page.filter(
    (task) =>
      taskWantsEvent(task, rule) &&
      !taskHasEvent(task) &&
      task.calendarSyncIssue !== 'event_removed',
  )
  for (const [index, task] of pending.entries())
    await schedulePush(ctx, userId, task.id, index * PUSH_STAGGER_MS)
  return pending.length * PUSH_STAGGER_MS
}

async function removeAutoAddedPage(
  ctx: MutationCtx,
  userId: string,
  page: Array<Doc<'tasks'>>,
) {
  const autoAdded = page.filter((task) => task.addToCalendar !== true)
  for (const task of autoAdded) {
    if (task.calendarSyncIssue === 'event_removed')
      await ctx.db.patch(task._id, { calendarSyncIssue: undefined })
  }
  await scheduleRemoval(ctx, userId, eventsToDelete(autoAdded))
}

export const sweep = internalMutation({
  args: {
    userId: v.string(),
    mode: sweepMode,
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const rule = syncRule(await readUserSettings(ctx, args.userId))
    if (args.mode === 'backfill' && !rule.syncEnabled) return
    if (args.mode === 'removeAutoAdded' && (!rule.syncEnabled || rule.autoAdd))
      return
    const page = await ctx.db
      .query('tasks')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .paginate({ numItems: SWEEP_PAGE, cursor: args.cursor })
    let delayMs = 0
    if (args.mode === 'backfill')
      delayMs = await backfillPage(ctx, args.userId, rule, page.page)
    else if (args.mode === 'removeAutoAdded')
      await removeAutoAddedPage(ctx, args.userId, page.page)
    else await scheduleRemoval(ctx, args.userId, eventsToDelete(page.page))
    if (page.isDone) return
    await ctx.scheduler.runAfter(delayMs, internal.calendarSync.sweep, {
      ...args,
      cursor: page.continueCursor,
    })
  },
})
