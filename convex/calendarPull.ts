import { v } from 'convex/values'
import * as z from 'zod'

import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server'
import { internal } from './_generated/api'
import { getWritable, requireUserId } from './access'
import { readUserSettings } from './calendarSync'
import { openGoogleCalendar } from './googleCalendar'
import { newTask, storedProjectId, taskRow } from './taskModel'
import { dayStartIn, daysBetween } from './zonedTime'

import type { Infer } from 'convex/values'
import type { SyncFailure } from './googleCalendar'

const MAX_WINDOW_MS = 120 * 24 * 60 * 60 * 1000

const CACHE_PAGE = 400
const PRUNE_PAGE = 500
const STALE_CACHE_MS = 7 * 24 * 60 * 60 * 1000

const googleEvent = z.object({
  id: z.string(),
  status: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  htmlLink: z.string().optional(),
  start: z.object({
    date: z.string().optional(),
    dateTime: z.string().optional(),
  }),
  end: z
    .object({ date: z.string().optional(), dateTime: z.string().optional() })
    .optional(),
  extendedProperties: z
    .object({ private: z.record(z.string(), z.string()).optional() })
    .optional(),
})

const eventRow = v.object({
  eventId: v.string(),
  title: v.string(),
  notes: v.union(v.string(), v.null()),
  location: v.union(v.string(), v.null()),
  allDay: v.boolean(),
  start: v.number(),
  end: v.number(),
  link: v.union(v.string(), v.null()),
})

export type ExternalEventRow = Infer<typeof eventRow>

export type PullResult = { ok: true; events: number } | SyncFailure

export function externalRows(
  events: Array<unknown>,
  timeZone: string,
): Array<ExternalEventRow> {
  const rows: Array<ExternalEventRow> = []
  for (const raw of events) {
    const parsed = googleEvent.safeParse(raw)
    if (!parsed.success) continue
    const event = parsed.data
    if (event.status === 'cancelled') continue
    if (event.extendedProperties?.private?.lifeosTaskId) continue
    if (event.start.date) {
      const start = dayStartIn(event.start.date, timeZone)
      if (start === null) continue
      const span =
        event.end?.date !== undefined
          ? daysBetween(event.start.date, event.end.date)
          : 1
      rows.push({
        eventId: event.id,
        title: (event.summary ?? '').trim() || '(No title)',
        notes: (event.description ?? '').trim() || null,
        location: (event.location ?? '').trim() || null,
        allDay: true,
        start,
        end: start + span * 86_400_000,
        link: event.htmlLink ?? null,
      })
      continue
    }
    if (!event.start.dateTime) continue
    const start = Date.parse(event.start.dateTime)
    if (Number.isNaN(start)) continue
    const rawEnd = event.end?.dateTime ? Date.parse(event.end.dateTime) : NaN
    const end =
      Number.isNaN(rawEnd) || rawEnd <= start ? start + 60 * 60_000 : rawEnd
    rows.push({
      eventId: event.id,
      title: (event.summary ?? '').trim() || '(No title)',
      notes: (event.description ?? '').trim() || null,
      location: (event.location ?? '').trim() || null,
      allDay: false,
      start,
      end,
      link: event.htmlLink ?? null,
    })
  }
  return rows
}

export const pullExternalEvents = action({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, args): Promise<PullResult> => {
    const userId = await requireUserId(ctx)
    const from = Math.min(args.from, args.to)
    const to = Math.max(Math.min(args.to, from + MAX_WINDOW_MS), from)

    const timeZone = await ctx.runQuery(internal.calendarPull.userTimeZone, {})
    if (!timeZone)
      return {
        ok: false,
        reason: 'no_timezone',
        detail:
          'Life OS does not know your timezone yet, so it will not guess. Reopen the app once, then try again.',
      }

    const opened = await openGoogleCalendar(userId)
    if (!opened.ok) return opened
    const listing = await opened.calendar.list(from, to)
    if (!listing.ok) return listing

    const fetchedAt = Date.now()
    const rows = externalRows(listing.items, timeZone)
    for (let index = 0; index < rows.length; index += CACHE_PAGE) {
      await ctx.runMutation(internal.calendarPull.applyRows, {
        userId,
        fetchedAt,
        events: rows.slice(index, index + CACHE_PAGE),
      })
    }
    await ctx.runMutation(internal.calendarPull.pruneBefore, {
      userId,
      cutoff: fetchedAt,
    })
    return { ok: true, events: rows.length }
  },
})

export const userTimeZone = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx)
    return (await readUserSettings(ctx, userId))?.timeZone ?? null
  },
})

export const applyRows = internalMutation({
  args: {
    userId: v.string(),
    fetchedAt: v.number(),
    events: v.array(eventRow),
  },
  handler: async (ctx, args) => {
    for (const event of args.events) {
      const existing = await ctx.db
        .query('calendarEvents')
        .withIndex('by_user_eventId', (q) =>
          q.eq('userId', args.userId).eq('eventId', event.eventId),
        )
        .first()
      if (existing) {
        await ctx.db.patch(existing._id, {
          ...event,
          fetchedAt: args.fetchedAt,
        })
        continue
      }
      await ctx.db.insert('calendarEvents', {
        userId: args.userId,
        ...event,
        fetchedAt: args.fetchedAt,
      })
    }
  },
})

export const pruneBefore = internalMutation({
  args: { userId: v.string(), cutoff: v.number() },
  handler: async (ctx, args) => {
    const stale = await ctx.db
      .query('calendarEvents')
      .withIndex('by_user_fetchedAt', (q) =>
        q.eq('userId', args.userId).lt('fetchedAt', args.cutoff),
      )
      .take(PRUNE_PAGE)
    for (const row of stale) await ctx.db.delete(row._id)
    if (stale.length === PRUNE_PAGE)
      await ctx.scheduler.runAfter(0, internal.calendarPull.pruneBefore, args)
  },
})

export const purgeStaleCache = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stale = await ctx.db
      .query('calendarEvents')
      .withIndex('by_fetchedAt', (q) =>
        q.lt('fetchedAt', Date.now() - STALE_CACHE_MS),
      )
      .take(PRUNE_PAGE)
    for (const row of stale) await ctx.db.delete(row._id)
    if (stale.length === PRUNE_PAGE)
      await ctx.scheduler.runAfter(0, internal.calendarPull.purgeStaleCache, {})
  },
})

export const listExternalEvents = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const rows = await ctx.db
      .query('calendarEvents')
      .withIndex('by_user_start', (q) =>
        q.eq('userId', userId).lt('start', Math.max(args.from, args.to)),
      )
      .take(2000)
    const from = Math.min(args.from, args.to)
    return rows
      .filter((row) => row.end > from)
      .map((row) => ({
        eventId: row.eventId,
        title: row.title,
        notes: row.notes,
        location: row.location,
        allDay: row.allDay,
        start: row.start,
        end: row.end,
        link: row.link,
      }))
  },
})

export const importEvent = mutation({
  args: {
    eventId: v.string(),
    taskId: v.string(),
    projectId: v.string(),
    position: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const row = await ctx.db
      .query('calendarEvents')
      .withIndex('by_user_eventId', (q) =>
        q.eq('userId', userId).eq('eventId', args.eventId),
      )
      .first()
    if (!row)
      throw new Error(
        'That event is no longer in the calendar. Refresh Calendar view and try again.',
      )
    const projectId = storedProjectId(args.projectId)
    if (projectId !== null) {
      const project = await getWritable(ctx, userId, 'projects', projectId)
      if (project.spaceId) throw new Error('Calendar import is personal only')
    }
    const existing = await ctx.db
      .query('tasks')
      .withIndex('by_user_id', (q) =>
        q.eq('userId', userId).eq('id', args.taskId),
      )
      .first()
    if (existing) return
    await ctx.db.insert(
      'tasks',
      taskRow(importedTask(row, args, Date.now()), userId),
    )
  },
})

export function importedTask(
  event: ExternalEventRow,
  target: { taskId: string; projectId: string; position: number },
  now: number,
) {
  return newTask(
    {
      id: target.taskId,
      projectId: target.projectId,
      spaceId: null,
      title: event.title,
      notes: event.notes,
      position: target.position,
      dueAt: event.start,
      durationMinutes: event.allDay ? null : (event.end - event.start) / 60_000,
      importedFromEventId: event.eventId,
    },
    now,
  )
}
