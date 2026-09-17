import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { getUserSettings, requireUserId } from './lib'
import { eventIdsForTasks } from './calendar'

import type { MutationCtx } from './_generated/server'
import type { Doc } from './_generated/dataModel'

/**
 * Per-user calendar preferences.
 *
 * Two things used to live here that no longer do. `googleConnected` was a flag
 * we set ourselves, which meant a failed OAuth attempt could still leave the
 * app believing Google was connected. Whether Google is connected is Clerk's
 * fact, so the client reads it from Clerk and the server re-checks it when it
 * actually needs a token. And `calendarEnabled` / `calendarSyncEnabled` were
 * two stored names for one switch, mirrored into each other by hand in four
 * branches. Both columns still exist for old rows and are written together,
 * but the API exposes one field.
 */

const DEFAULT_REMINDER_MINUTES = 15

const DEFAULTS = {
  syncEnabled: false,
  defaultReminderMinutes: DEFAULT_REMINDER_MINUTES,
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
      timeZone: row.timeZone ?? null,
    }
  },
})

/**
 * Turning sync off has to take the events with it, or the user is left with a
 * calendar full of reminders for a feature they switched off. The fan-out is
 * scheduled because the Google call cannot run inside a mutation; the client
 * names the deletion before it happens.
 */
async function scheduleSyncOffCleanup(ctx: MutationCtx, userId: string) {
  const tasks = await ctx.db
    .query('tasks')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect()
  const eventIds = eventIdsForTasks(tasks)
  if (eventIds.length === 0) return
  await ctx.scheduler.runAfter(0, internal.calendar.deleteEventsForUser, {
    userId,
    eventIds,
  })
}

export const updateCalendarSettings = mutation({
  args: {
    syncEnabled: v.optional(v.boolean()),
    defaultReminderMinutes: v.optional(v.number()),
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
        ...(args.timeZone !== undefined && { timeZone: args.timeZone }),
        createdAt: now,
        updatedAt: now,
      })
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
    if (args.timeZone !== undefined) patch.timeZone = args.timeZone
    await ctx.db.patch(existing._id, patch)

    if (turningSyncOff) await scheduleSyncOffCleanup(ctx, userId)
  },
})
