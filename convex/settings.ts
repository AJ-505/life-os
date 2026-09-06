import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import { getUserSettings, requireUserId } from './lib'

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
    }
  },
})

export const updateCalendarSettings = mutation({
  args: {
    syncEnabled: v.optional(v.boolean()),
    defaultReminderMinutes: v.optional(v.number()),
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
        createdAt: now,
        updatedAt: now,
      })
      return
    }

    const patch: {
      updatedAt: number
      calendarSyncEnabled?: boolean
      calendarEnabled?: boolean
      defaultReminderMinutes?: number
    } = { updatedAt: now }
    if (args.syncEnabled !== undefined) {
      patch.calendarSyncEnabled = args.syncEnabled
      patch.calendarEnabled = args.syncEnabled
    }
    if (args.defaultReminderMinutes !== undefined) {
      patch.defaultReminderMinutes = args.defaultReminderMinutes
    }
    await ctx.db.patch(existing._id, patch)
  },
})
