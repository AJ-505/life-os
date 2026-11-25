import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import { getWritable, requireMember, requireUserId } from './access'
import { afterSettingsChange, readUserSettings } from './calendarSync'
import { DEFAULT_REMINDER_MINUTES, syncRule } from './syncRule'
import { NO_PROJECT_ID } from './taskModel'

import type { Doc } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Scope } from './access'

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
    const row = await readUserSettings(ctx, userId)
    if (!row) return DEFAULTS
    return {
      syncEnabled: row.calendarSyncEnabled,
      defaultReminderMinutes: row.defaultReminderMinutes,
      autoAddToCalendar: row.autoAddToCalendar ?? false,
      timeZone: row.timeZone ?? null,
    }
  },
})

type SettingsChange = {
  syncEnabled?: boolean
  defaultReminderMinutes?: number
  autoAddToCalendar?: boolean
  timeZone?: string
}

function settingsPatch(change: SettingsChange): Partial<Doc<'userSettings'>> {
  return {
    ...(change.syncEnabled !== undefined && {
      calendarSyncEnabled: change.syncEnabled,
    }),
    ...(change.defaultReminderMinutes !== undefined && {
      defaultReminderMinutes: change.defaultReminderMinutes,
    }),
    ...(change.autoAddToCalendar !== undefined && {
      autoAddToCalendar: change.autoAddToCalendar,
    }),
    ...(change.timeZone !== undefined && { timeZone: change.timeZone }),
  }
}

export const updateCalendarSettings = mutation({
  args: {
    syncEnabled: v.optional(v.boolean()),
    defaultReminderMinutes: v.optional(v.number()),
    autoAddToCalendar: v.optional(v.boolean()),
    timeZone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const existing = await readUserSettings(ctx, userId)
    const now = Date.now()
    const patch = settingsPatch(args)
    if (existing) await ctx.db.patch(existing._id, { ...patch, updatedAt: now })
    else
      await ctx.db.insert('userSettings', {
        userId,
        calendarSyncEnabled: DEFAULTS.syncEnabled,
        defaultReminderMinutes: DEFAULTS.defaultReminderMinutes,
        ...patch,
        createdAt: now,
        updatedAt: now,
      })
    await afterSettingsChange(
      ctx,
      userId,
      syncRule(existing),
      syncRule(await readUserSettings(ctx, userId)),
    )
  },
})

export async function lastProjectRow(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  spaceId: Scope,
): Promise<Doc<'lastProjects'> | null> {
  return await ctx.db
    .query('lastProjects')
    .withIndex('by_user_space', (q) =>
      q.eq('userId', userId).eq('spaceId', spaceId),
    )
    .unique()
}

const scopeArg = v.union(v.string(), v.null())

export const getLastProject = query({
  args: { spaceId: scopeArg },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const row = await lastProjectRow(ctx, userId, args.spaceId)
    return row?.projectId ?? null
  },
})

async function requireProjectOnBoard(
  ctx: MutationCtx,
  userId: string,
  spaceId: Scope,
  projectId: string,
) {
  if (spaceId !== null) await requireMember(ctx, userId, spaceId)
  if (projectId === NO_PROJECT_ID) return
  const project = await getWritable(ctx, userId, 'projects', projectId)
  if ((project.spaceId ?? null) !== spaceId)
    throw new Error('That project is on another board')
}

export const setLastProject = mutation({
  args: { spaceId: scopeArg, projectId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    await requireProjectOnBoard(ctx, userId, args.spaceId, args.projectId)
    const row = await lastProjectRow(ctx, userId, args.spaceId)
    if (row?.projectId === args.projectId) return
    const updatedAt = Date.now()
    if (row) {
      await ctx.db.patch(row._id, { projectId: args.projectId, updatedAt })
      return
    }
    await ctx.db.insert('lastProjects', {
      userId,
      spaceId: args.spaceId,
      projectId: args.projectId,
      updatedAt,
    })
  },
})
