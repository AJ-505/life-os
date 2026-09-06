import { v } from 'convex/values'

import { action, internalMutation, internalQuery } from './_generated/server'
import { internal } from './_generated/api'
import { getOwnedTask, getUserSettings, requireUserId } from './lib'

/**
 * One-way push: Life OS task ▸ Google Calendar.
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
 * The whole feature is one call from the client's point of view:
 * `syncTask({ taskId })`. Create, update, delete and "nothing to do" are all
 * decided in here from the task's own state, so no caller has to know Google
 * has an API.
 */

const GOOGLE_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const GCAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

/** How long a task's calendar block runs. Tasks have a due *moment*, not a
 *  duration, so we give the event a nominal hour. */
const EVENT_MINUTES = 60

/* ------------------------------------------------------------------ result
 * A closed set of outcomes. The client renders a message per case and never
 * has to interpret an HTTP status — the mapping from Google's failures to
 * "what the user should do about it" happens once, here. */
export type SyncResult =
  | { ok: true; action: 'created' | 'updated' | 'deleted' | 'noop'; link: string | null }
  | { ok: false; reason: 'not_connected' | 'missing_scope' | 'google_error' | 'not_configured'; detail: string }

/* -------------------------------------------------------------- internals */

export const taskForSync = internalQuery({
  args: { userId: v.string(), taskId: v.string() },
  handler: async (ctx, args) => {
    const task = await getOwnedTask(ctx, args.userId, args.taskId)
    const settings = await getUserSettings(ctx, args.userId)
    return {
      title: task.title,
      notes: task.notes,
      dueAt: task.dueAt,
      addToCalendar: task.addToCalendar ?? false,
      calendarEventId: task.calendarEventId ?? null,
      reminderMinutes:
        task.reminderMinutes ?? settings?.defaultReminderMinutes ?? 15,
      syncEnabled: settings?.calendarSyncEnabled ?? false,
    }
  },
})

export const setEventId = internalMutation({
  args: {
    userId: v.string(),
    taskId: v.string(),
    calendarEventId: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const task = await getOwnedTask(ctx, args.userId, args.taskId)
    await ctx.db.patch(task._id, { calendarEventId: args.calendarEventId })
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
 * problems with two different fixes.
 */
async function googleAccessToken(
  clerkUserId: string,
): Promise<
  | { ok: true; token: string; scopes: Array<string> }
  | { ok: false; reason: 'not_configured' | 'not_connected'; detail: string }
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
    const res = await fetch(
      `https://api.clerk.com/v1/users/${clerkUserId}/oauth_access_tokens/${provider}`,
      { headers: { Authorization: `Bearer ${secret}` } },
    )
    if (!res.ok) continue

    // Clerk returns a bare array on older API versions and a paginated
    // `{ data }` envelope on newer ones.
    const body = (await res.json()) as
      | Array<{ token?: string; scopes?: Array<string> }>
      | { data?: Array<{ token?: string; scopes?: Array<string> }> }
    const entries = Array.isArray(body) ? body : (body.data ?? [])
    const entry = entries.find((e) => typeof e.token === 'string')
    if (entry?.token) {
      return { ok: true, token: entry.token, scopes: entry.scopes ?? [] }
    }
  }

  return {
    ok: false,
    reason: 'not_connected',
    detail: 'No Google account is connected to this Clerk user.',
  }
}

function eventBody(task: {
  title: string
  notes: string | null
  dueAt: number
  reminderMinutes: number
}) {
  const start = new Date(task.dueAt)
  const end = new Date(task.dueAt + EVENT_MINUTES * 60 * 1000)
  return {
    summary: task.title,
    description: task.notes ?? '',
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    reminders: {
      useDefault: false,
      overrides: [{ method: 'popup', minutes: task.reminderMinutes }],
    },
  }
}

/* ------------------------------------------------------------------ public */

/**
 * Idempotent by design: it reads the task's current state and makes Google
 * match, so a retry after a network failure is safe and a double-click costs
 * one no-op instead of two events.
 */
export const syncTask = action({
  args: { taskId: v.string() },
  handler: async (ctx, args): Promise<SyncResult> => {
    const userId = await requireUserId(ctx)
    const task = await ctx.runQuery(internal.calendar.taskForSync, {
      userId,
      taskId: args.taskId,
    })

    const wantsEvent =
      task.syncEnabled && task.addToCalendar && task.dueAt !== null
    const hasEvent = task.calendarEventId !== null

    if (!wantsEvent && !hasEvent) {
      return { ok: true, action: 'noop', link: null }
    }

    const auth = await googleAccessToken(userId)
    if (!auth.ok) return { ok: false, reason: auth.reason, detail: auth.detail }
    if (!auth.scopes.includes(GOOGLE_EVENTS_SCOPE)) {
      return {
        ok: false,
        reason: 'missing_scope',
        detail: `The connected Google account has not granted ${GOOGLE_EVENTS_SCOPE}.`,
      }
    }
    const headers = {
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
    }

    if (!wantsEvent) {
      const res = await fetch(`${GCAL}/${task.calendarEventId}`, {
        method: 'DELETE',
        headers,
      })
      // A 404 counts as success: Google has already lost the event, which is
      // the state we were trying to reach.
      if (!res.ok && res.status !== 404) {
        return {
          ok: false,
          reason: 'google_error',
          detail: `Google returned ${res.status} deleting the event.`,
        }
      }
      await ctx.runMutation(internal.calendar.setEventId, {
        userId,
        taskId: args.taskId,
        calendarEventId: null,
      })
      return { ok: true, action: 'deleted', link: null }
    }

    const body = JSON.stringify(
      eventBody({
        title: task.title,
        notes: task.notes,
        dueAt: task.dueAt!,
        reminderMinutes: task.reminderMinutes,
      }),
    )

    // A 404 on patch means the event was deleted from the calendar side. Fall
    // through to a create rather than report an error the user can't act on.
    let res: Response | null = null
    let performed: 'created' | 'updated' = 'created'
    if (hasEvent) {
      res = await fetch(`${GCAL}/${task.calendarEventId}`, {
        method: 'PATCH',
        headers,
        body,
      })
      if (res.status === 404) res = null
      else performed = 'updated'
    }
    if (!res) {
      res = await fetch(GCAL, { method: 'POST', headers, body })
      performed = 'created'
    }

    if (!res.ok) {
      return {
        ok: false,
        reason: res.status === 403 ? 'missing_scope' : 'google_error',
        detail: `Google returned ${res.status} writing the event.`,
      }
    }

    const created = (await res.json()) as { id?: string; htmlLink?: string }
    if (created.id && created.id !== task.calendarEventId) {
      await ctx.runMutation(internal.calendar.setEventId, {
        userId,
        taskId: args.taskId,
        calendarEventId: created.id,
      })
    }
    return { ok: true, action: performed, link: created.htmlLink ?? null }
  },
})
