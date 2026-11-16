import { v } from 'convex/values'

import { internalMutation, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { getUserSettings, requireUserId } from './lib'
import { eventsToDelete, taskWantsEvent } from './calendar'

import type { MutationCtx } from './_generated/server'
import type { Doc } from './_generated/dataModel'

const DEFAULT_REMINDER_MINUTES = 15

const DEFAULTS = {
  syncEnabled: false,
  defaultReminderMinutes: DEFAULT_REMINDER_MINUTES,
  autoAddToCalendar: false,
  timeZone: null as string | null,
}

export const getCalendarSettings = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx)
    const row = await getUserSettings(ctx, userId)
    if (!row) return DEFAULTS
    return {
      syncEnabled: row.calendarSyncEnabled,
      defaultReminderMinutes: row.defaultReminderMinutes,
      autoAddToCalendar: row.autoAddToCalendar ?? false,
      timeZone: row.timeZone ?? null,
    }
  },
})

async function scheduleSyncOffCleanup(ctx: MutationCtx, userId: string) {
  await ctx.scheduler.runAfter(0, internal.settings.continueSyncOffCleanup, {
    userId,
    cursor: null,
  })
}

export const continueSyncOffCleanup = internalMutation({
  args: { userId: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query('tasks')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .paginate({ numItems: 500, cursor: args.cursor })
    const events = eventsToDelete(page.page)
    if (events.length > 0) {
      await ctx.scheduler.runAfter(0, internal.calendar.deleteEventsForUser, {
        userId: args.userId,
        events,
      })
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.settings.continueSyncOffCleanup,
        { userId: args.userId, cursor: page.continueCursor },
      )
    }
  },
})

const AUTO_SYNC_PAGE = 100
const AUTO_SYNC_STAGGER_MS = 300

async function scheduleAutoSyncOn(ctx: MutationCtx, userId: string) {
  await ctx.scheduler.runAfter(0, internal.settings.continueAutoSyncOn, {
    userId,
    cursor: null,
  })
}

async function scheduleAutoSyncOff(ctx: MutationCtx, userId: string) {
  await ctx.scheduler.runAfter(0, internal.settings.continueAutoSyncOff, {
    userId,
    cursor: null,
  })
}

export const continueAutoSyncOn = internalMutation({
  args: { userId: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const row = await getUserSettings(ctx, args.userId)
    const settings = {
      syncEnabled: row?.calendarSyncEnabled ?? false,
      autoAdd: row?.autoAddToCalendar ?? false,
    }
    if (!settings.syncEnabled || !settings.autoAdd) return
    const page = await ctx.db
      .query('tasks')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .paginate({ numItems: AUTO_SYNC_PAGE, cursor: args.cursor })
    const pending = page.page.filter(
      (task) =>
        taskWantsEvent(task, settings) &&
        (task.calendarEventId ?? null) === null &&
        task.calendarSyncIssue !== 'event_removed',
    )
    for (const [index, task] of pending.entries()) {
      await ctx.scheduler.runAfter(
        index * AUTO_SYNC_STAGGER_MS,
        internal.calendar.syncTaskForUser,
        { userId: args.userId, taskId: task.id, attempt: 0 },
      )
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        pending.length * AUTO_SYNC_STAGGER_MS,
        internal.settings.continueAutoSyncOn,
        { userId: args.userId, cursor: page.continueCursor },
      )
    }
  },
})

export const continueAutoSyncOff = internalMutation({
  args: { userId: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const row = await getUserSettings(ctx, args.userId)
    if (!row?.calendarSyncEnabled || row.autoAddToCalendar) return
    const page = await ctx.db
      .query('tasks')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .paginate({ numItems: 500, cursor: args.cursor })
    const autoOnly = page.page.filter((task) => task.addToCalendar !== true)
    for (const task of autoOnly) {
      if (task.calendarSyncIssue === 'event_removed') {
        await ctx.db.patch(task._id, { calendarSyncIssue: undefined })
      }
    }
    const events = eventsToDelete(autoOnly)
    if (events.length > 0) {
      await ctx.scheduler.runAfter(0, internal.calendar.deleteEventsForUser, {
        userId: args.userId,
        events,
      })
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.settings.continueAutoSyncOff, {
        userId: args.userId,
        cursor: page.continueCursor,
      })
    }
  },
})

export const updateCalendarSettings = mutation({
  args: {
    syncEnabled: v.optional(v.boolean()),
    defaultReminderMinutes: v.optional(v.number()),
    autoAddToCalendar: v.optional(v.boolean()),
    timeZone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const existing = await getUserSettings(ctx, userId)
    const now = Date.now()

    if (!existing) {
      const syncEnabled = args.syncEnabled ?? DEFAULTS.syncEnabled
      await ctx.db.insert('userSettings', {
        userId,
        calendarSyncEnabled: syncEnabled,
        calendarEnabled: syncEnabled,
        defaultReminderMinutes:
          args.defaultReminderMinutes ?? DEFAULT_REMINDER_MINUTES,
        ...(args.autoAddToCalendar !== undefined && {
          autoAddToCalendar: args.autoAddToCalendar,
        }),
        ...(args.timeZone !== undefined && { timeZone: args.timeZone }),
        createdAt: now,
        updatedAt: now,
      })
      if (syncEnabled && args.autoAddToCalendar) {
        await scheduleAutoSyncOn(ctx, userId)
      }
      return
    }

    const patch: Partial<Doc<'userSettings'>> & { updatedAt: number } = {
      updatedAt: now,
    }
    const turningSyncOff =
      args.syncEnabled === false && existing.calendarSyncEnabled
    if (args.syncEnabled !== undefined) {
      patch.calendarSyncEnabled = args.syncEnabled
      patch.calendarEnabled = args.syncEnabled
    }
    if (args.defaultReminderMinutes !== undefined) {
      patch.defaultReminderMinutes = args.defaultReminderMinutes
    }
    if (args.autoAddToCalendar !== undefined) {
      patch.autoAddToCalendar = args.autoAddToCalendar
    }
    if (args.timeZone !== undefined) patch.timeZone = args.timeZone
    await ctx.db.patch(existing._id, patch)

    const wasSyncing = existing.calendarSyncEnabled
    const wasAuto = existing.autoAddToCalendar ?? false
    const syncing = patch.calendarSyncEnabled ?? wasSyncing
    const auto = patch.autoAddToCalendar ?? wasAuto
    if (turningSyncOff) await scheduleSyncOffCleanup(ctx, userId)
    else if (syncing && auto && !(wasSyncing && wasAuto)) {
      await scheduleAutoSyncOn(ctx, userId)
    } else if (syncing && wasSyncing && wasAuto && !auto) {
      await scheduleAutoSyncOff(ctx, userId)
    }
  },
})
