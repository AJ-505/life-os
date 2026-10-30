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
import {
  GOOGLE_EVENTS_SCOPE,
  googleAccessToken,
  request,
  statusOutcome,
  transportOutcome,
} from './calendar'
import {
  clampDuration,
  getWritableProject,
  getUserSettings,
  requireUserId,
} from './lib'

import type { SyncFailure } from './calendar'
import type { MutationCtx } from './_generated/server'

/**
 * Backward integration: Google Calendar → Life OS.
 *
 * The push side (`calendar.ts`) turns Life OS tasks into Google events. This
 * module is the mirror image: it reads the events that live in the user's real
 * calendar and makes them visible — and, on one explicit click, actionable —
 * inside Life OS.
 *
 * Two boundaries shape everything here:
 *
 * - **Cache, not truth.** Google owns the event; we keep a shadow that is
 *   resumable. A pull re-fetches a window of the calendar, stamps every row it
 *   fetched, and prunes rows it did not touch. Deleting the cache loses
 *   nothing: the next pull rebuilds it.
 * - **Import is a copy, not a link.** "Add as task" creates a task that carries
 *   `importedFromEventId` for idempotence — a second import of the same event
 *   id cannot double it — but the task then lives its own life. Editing either
 *   side after import does not propagate. That is deliberate (see the client
 *   hook for the tradeoff) and is why `taskWantsEvent` refuses to push an
 *   imported task: Life OS no longer owns the slot it came from.
 *
 * Recurring series arrive with `singleEvents=true`, so every occurrence is its
 * own row and its own importable event. The strictly-once semantics this
 * enables (import one instance, not a rule) beat carrying recurrence rules we
 * would then have to expand forever.
 */

const GCAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

/** Pull windows are what one calendar view asks for, padded. Anything larger
 *  is a bug on the caller side, and an unbounded window is an unbounded
 *  response, so the request is clamped rather than trusted. */
const MAX_WINDOW_MS = 120 * 24 * 60 * 60 * 1000

/** Google returns up to 2500 events per list; the page cap bounds a pathological
 *  calendar (someone syncing a decade of recurring meetings) instead of making
 *  the action run unbounded.   Beyond the cap the cache holds *a* window of the
 *  calendar, silently truncated, which is honest for a cache. */
const MAX_PAGES = 20

const PAGE_SIZE = 250

/** Client-side opt-out is not enough for a shared space: the cache is
 *  private (one user's calendar), so import must refuse to write into a
 *  shared project where members who cannot see the calendar would read it.
 *  That refusal is written inside `importEvent`, not as an exception class
 *  here. */

/* ------------------------------------------------------------------ shapes */

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
  /** Only read to recognise our own pushed events. Anything unknown is left
   *  alone — the wire may carry more than we model. */
  extendedProperties: z
    .object({ private: z.record(z.string(), z.string()).optional() })
    .optional(),
})

const eventList = z.object({
  items: z.array(z.unknown()).optional(),
  nextPageToken: z.string().optional(),
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

export type ExternalEventRow = {
  eventId: string
  title: string
  notes: string | null
  location: string | null
  allDay: boolean
  start: number
  end: number
  link: string | null
}

export type PullResult =
  | { ok: true; events: number }
  /** The full push failure set, so the pull can share the outcome helpers
   *  verbatim; only the reachable cases have client copy. */
  | SyncFailure

/* ------------------------------------------------------------------ clock */

/** The wall clock in `timeZone`, as an epoch-ms reading that pretends the zone
 *  is UTC. Used to invert `zonedDayStart`. */
function wallClockAsUTC(epochMs: number, timeZone: string): number {
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
    Number(parts.find((part) => part.type === type)?.value ?? '0')
  return Date.UTC(
    at('year'),
    at('month') - 1,
    at('day'),
    at('hour'),
    at('minute'),
    at('second'),
  )
}

/**
 * The instant that is local midnight in `timeZone` for a `YYYY-MM-DD` date.
 *
 * Google hands all-day events a bare date with no offset, so the zone has to
 * come from somewhere: the same user timezone setting the push side already
 * keeps. Two passes usually converge; a DST boundary can push the second pass
 * off by an hour without changing any wall clock we display, because the row
 * is rendered on the day its date names.
 */
export function zonedDayStart(ymd: string, timeZone: string): number | null {
  const match = /^([+-]?\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!match) return null
  const [, year, month, day] = match
  let instant = Date.parse(`${ymd}T00:00:00Z`)
  if (Number.isNaN(instant)) return null
  for (let pass = 0; pass < 2; pass++) {
    instant +=
      Date.UTC(+year, +month - 1, +day) - wallClockAsUTC(instant, timeZone)
  }
  return instant
}

/** Whole days from one `YYYY-MM-DD` to the next, for multi-day all-day
 *  events whose `end.date` is exclusive. */
function daysBetween(fromYmd: string, untilYmd: string): number {
  const from = Date.parse(`${fromYmd}T00:00:00Z`)
  const until = Date.parse(`${untilYmd}T00:00:00Z`)
  if (Number.isNaN(from) || Number.isNaN(until)) return 1
  return Math.max(1, Math.round((until - from) / 86_400_000))
}

/**
 * Network shape → cache row. Parsed, never asserted, and filtered in one
 * place: cancelled events, our own pushed events (they carry a
 * `lifeosTaskId` extended property, which is exactly how the push side marks
 * them), and shapes that do not decode are dropped here rather than leaking
 * into the UI or worse, into an import.
 */
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
      const start = zonedDayStart(event.start.date, timeZone)
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

function eventsUrl(fromMs: number, toMs: number, pageToken?: string): string {
  const params = new URLSearchParams({
    timeMin: new Date(fromMs).toISOString(),
    timeMax: new Date(toMs).toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    showDeleted: 'false',
    maxResults: String(PAGE_SIZE),
    ...(pageToken ? { pageToken } : {}),
  })
  return `${GCAL}?${params.toString()}`
}

/* ------------------------------------------------------------------ pull */

const CACHE_PAGE = 400

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

    const auth = await googleAccessToken(userId)
    if (!auth.ok)
      return {
        ok: false,
        reason: auth.reason,
        detail: auth.detail,
      }
    if (!auth.scopes.includes(GOOGLE_EVENTS_SCOPE))
      return {
        ok: false,
        reason: 'missing_scope',
        detail: `The connected Google account has not granted ${GOOGLE_EVENTS_SCOPE}.`,
      }

    const headers = { Authorization: `Bearer ${auth.token}` }
    const raws: Array<unknown> = []
    let pageToken: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const attempt = await request(eventsUrl(from, to, pageToken), { headers })
      if (!attempt.ok)
        return transportOutcome(`reading the calendar: ${attempt.detail}`)
      if (!attempt.response.ok)
        return statusOutcome(attempt.response.status, 'reading your calendar')
      let listing: z.infer<typeof eventList>
      try {
        const parsed = eventList.safeParse(await attempt.response.json())
        if (!parsed.success)
          return {
            ok: false,
            reason: 'google_error',
            detail: 'Google sent a response Life OS could not read.',
          }
        listing = parsed.data
      } catch (error) {
        return {
          ok: false,
          reason: 'google_error',
          detail: `Google sent a response Life OS could not read: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
      raws.push(...(listing.items ?? []))
      if (!listing.nextPageToken) break
      pageToken = listing.nextPageToken
    }

    // The stamp is taken *before* the first write, so a row written by this
    // pull can never be mistaken for one that a prune should drop, even when
    // the clock ticks between pages.
    const fetchedAt = Date.now()
    const rows = externalRows(raws, timeZone)
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
    return (await getUserSettings(ctx, userId))?.timeZone ?? null
  },
})

/**
 * Upsert one page of fetched rows. Patch-in-place on the Google event id keeps
 * a re-fetched calendar stable: an edited event updates its row, an untouched
 * one keeps its `_creationTime`, and nothing accumulates across pulls.
 */
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

/**
 * Drop every cached row this pull did not stamp. The index range makes the
 * walk cheap and self-continuing when one transaction cannot carry it.
 */
export const pruneBefore = internalMutation({
  args: { userId: v.string(), cutoff: v.number() },
  handler: async (ctx, args) => {
    const stale = await ctx.db
      .query('calendarEvents')
      .withIndex('by_user_fetchedAt', (q) =>
        q.eq('userId', args.userId).lt('fetchedAt', args.cutoff),
      )
      .take(500)
    for (const row of stale) await ctx.db.delete(row._id)
    if (stale.length === 500) {
      await ctx.scheduler.runAfter(0, internal.calendarPull.pruneBefore, args)
    }
  },
})

/**
 * Clean up accounts that stopped opening Life OS. The pull-side prune only
 * ever runs for a user who pulls; this cron is what bounds the table for
 * everyone else. A full-table walk paginated by `_creationTime`: the table is
 * bounded by the per-pull prune to roughly one window per active user, so a
 * daily pass is cheap.
 */
export const purgeStaleCache = internalMutation({
  args: {},
  handler: async (ctx) => {
    await continuePurgeStaleCache(
      ctx,
      Date.now() - 7 * 24 * 60 * 60 * 1000,
      null,
    )
  },
})

const PURGE_BATCH = 500

export const purgePageContinue = internalMutation({
  args: { cutoff: v.number(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    await continuePurgeStaleCache(ctx, args.cutoff, args.cursor)
  },
})

async function continuePurgeStaleCache(
  ctx: MutationCtx,
  cutoff: number,
  cursor: string | null,
) {
  const page = await ctx.db
    .query('calendarEvents')
    .paginate({ numItems: PURGE_BATCH, cursor })
  for (const row of page.page) {
    if (row.fetchedAt < cutoff) await ctx.db.delete(row._id)
  }
  if (!page.isDone) {
    await ctx.scheduler.runAfter(0, internal.calendarPull.purgePageContinue, {
      cutoff,
      cursor: page.continueCursor,
    })
  }
}

/* ------------------------------------------------------------------ read */

/**
 * The cache slice one calendar view needs. The range query is the whole
 * window; an event that overlaps it must satisfy `start < to`, so the index
 * cut at `start < to` plus an in-memory `end > from` filter is exact, and the
 * table is bounded by the prune to roughly one pull's worth of events.
 */
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

/* ------------------------------------------------------------------ import */

/**
 * Copy one cached event onto the personal board as a task.
 *
 * Deterministic on the pair (eventId, taskId): the import client generates the
 * task id optimistically, and a retried click lands on the same id, so a
 * repeat is a no-op rather than a duplicate. The Google event id is the *event*
 * key, not the task key, so two different tasks may, rarely, point at the same
 * event after a delete-plus-reimport — that is the copy semantics doing its
 * job and not something to deduplicate.
 */
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
    const project = await getWritableProject(ctx, userId, args.projectId)
    if (project.spaceId) throw new Error('Calendar import is personal only')
    const existing = await ctx.db
      .query('tasks')
      .withIndex('by_user_id', (q) =>
        q.eq('userId', userId).eq('id', args.taskId),
      )
      .first()
    if (existing) return
    await ctx.db.insert('tasks', {
      userId,
      id: args.taskId,
      projectId: args.projectId,
      parentId: null,
      title: row.title,
      notes: row.notes,
      position: args.position,
      done: false,
      doneAt: null,
      archived: false,
      dueAt: row.start,
      durationMinutes: row.allDay
        ? null
        : clampDuration(Math.round((row.end - row.start) / 60_000)),
      importedFromEventId: row.eventId,
      inFocus: false,
      focusOrder: 0,
      createdAt: Date.now(),
      assigneeId: null,
      spaceId: null,
    })
  },
})
