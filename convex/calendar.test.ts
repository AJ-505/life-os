import { convexTest } from 'convex-test'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api, internal } from './_generated/api'
import schema from './schema'

import type { TestConvex } from 'convex-test'

/**
 * Calendar regressions found by the 2026-10-03 audit.
 *
 * Google and Clerk are stubbed at `fetch`, so the assertions are on the real
 * decision logic the action runs, not on a live account. The `known bugs` block
 * uses `it.fails` so the suite stays green while each bug is open.
 */

const modules = import.meta.glob([
  './**/*.ts',
  '!./**/*.test.ts',
  '!./test.setup.ts',
])

type T = TestConvex<typeof schema>

const asUser = (t: T) => t.withIdentity({ subject: 'user_a' })

const SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const GCAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

/** A real task id shape: the derived Google event id is the uuid without its
 *  hyphens, and only ids of at least five allowed characters map. */
const TASK_ID = 'abcdef12-3456-7890-abcd-ef1234567890'
const DERIVED = 'abcdef1234567890abcdef1234567890'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A personal task that already owns a Google event. */
async function seedSyncedTask(
  t: T,
  overrides: { calendarEventId?: string | null } = {},
) {
  await t.run(async (ctx) => {
    await ctx.db.insert('userSettings', {
      userId: 'user_a',
      calendarEnabled: true,
      calendarSyncEnabled: true,
      defaultReminderMinutes: 15,
      timeZone: 'UTC',
      createdAt: 1,
      updatedAt: 1,
    })
    await ctx.db.insert('tasks', {
      userId: 'user_a',
      id: TASK_ID,
      projectId: 'p1',
      parentId: null,
      title: 'Task',
      notes: null,
      position: 1,
      done: false,
      doneAt: null,
      archived: false,
      dueAt: Date.UTC(2026, 0, 2, 9, 0, 0),
      addToCalendar: true,
      calendarEventId:
        overrides.calendarEventId === undefined
          ? DERIVED
          : overrides.calendarEventId,
      inFocus: false,
      focusOrder: 0,
      createdAt: 1,
      spaceId: null,
    })
  })
}

/** Clerk answers with a valid token; Google's patch/create status is settable. */
function stubGoogle(options: { patchStatus?: number; createStatus?: number }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input)
    const method = (init?.method ?? 'GET').toUpperCase()

    if (url.includes('api.clerk.com')) {
      return new Response(
        JSON.stringify([
          {
            token: 'google-token',
            scopes: [SCOPE],
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    if (url.startsWith(`${GCAL}/`)) {
      return new Response('{}', { status: options.patchStatus ?? 200 })
    }
    if (url === GCAL && method === 'POST') {
      return new Response(
        JSON.stringify({ id: DERIVED, htmlLink: 'https://cal/x' }),
        {
          status: options.createStatus ?? 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    }
    return new Response('{}', { status: 500 })
  })
}

describe('calendar: known bugs', () => {
  it.fails('a single Resync recreates an event deleted in Google', async () => {
    const t = convexTest(schema, modules)
    await seedSyncedTask(t)
    // The event is gone on Google's side: every patch is a 404.
    vi.stubGlobal('fetch', stubGoogle({ patchStatus: 404 }))

    const result = await asUser(t).action(api.calendar.syncTask, {
      taskId: TASK_ID,
    })

    // C-1: the action returns `event_removed`, clears the id and fails, so the
    // advertised "Resync puts deleted events back" needs a second run.
    expect(result.ok).toBe(true)
  })

  it.fails('turning sync off clears calendarEventId on the task', async () => {
    const t = convexTest(schema, modules)
    await seedSyncedTask(t)

    await asUser(t).mutation(api.settings.updateCalendarSettings, {
      syncEnabled: false,
    })
    await t.mutation(internal.settings.continueSyncOffCleanup, {
      userId: 'user_a',
      cursor: null,
    })

    const task = await t.run(async (ctx) =>
      ctx.db
        .query('tasks')
        .withIndex('by_user_id', (q) =>
          q.eq('userId', 'user_a').eq('id', TASK_ID),
        )
        .first(),
    )
    // C-2: the cleanup deletes the Google event but leaves the dangling id.
    expect(task?.calendarEventId).toBeNull()
  })

  it.fails(
    'reports an invalid Clerk secret as a server misconfiguration',
    async () => {
      const t = convexTest(schema, modules)
      await seedSyncedTask(t, { calendarEventId: null })
      // Clerk rejects the deployment's secret on every provider slug.
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () => new Response('{"error":"invalid key"}', { status: 401 }),
        ),
      )

      const result = await asUser(t).action(api.calendar.syncTask, {
        taskId: TASK_ID,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        // C-3: this is `not_connected` today, blaming the user for the server's
        // bad credential.
        expect(result.reason).toBe('not_configured')
      }
    },
  )
})
