import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, internal } from './_generated/api'
import { eventTimes } from './calendar'
import schema from './schema'

import type { TestConvex } from 'convex-test'

const modules = import.meta.glob([
  './**/*.ts',
  '!./**/*.test.ts',
  '!./test.setup.ts',
])

type T = TestConvex<typeof schema>

const asUser = (t: T) => t.withIdentity({ subject: 'user_a' })

beforeEach(() => vi.useFakeTimers())

const SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const GCAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

const TASK_ID = 'abcdef12-3456-7890-abcd-ef1234567890'
const DERIVED = 'abcdef1234567890abcdef1234567890'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const drainScheduler = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers)

async function seedSyncedTask(
  t: T,
  overrides: {
    calendarEventId?: string | null
    done?: boolean
    addToCalendar?: boolean
  } = {},
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
      done: overrides.done ?? false,
      doneAt: null,
      archived: false,
      dueAt: Date.UTC(2026, 0, 2, 9, 0, 0),
      addToCalendar: overrides.addToCalendar ?? true,
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

function stubGoogle(options: {
  patchStatus?: number
  createStatus?: number
  deleteStatus?: number
}) {
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
    if (url === GCAL && method === 'POST') {
      return new Response(
        JSON.stringify({ id: DERIVED, htmlLink: 'https://cal/x' }),
        {
          status: options.createStatus ?? 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    }
    if (url.startsWith(`${GCAL}/`)) {
      const status =
        method === 'DELETE'
          ? (options.deleteStatus ?? 204)
          : (options.patchStatus ?? 200)
      return new Response(status === 204 ? null : '{}', { status })
    }
    return new Response('{}', { status: 500 })
  })
}

function readTask(t: T) {
  return t.run(async (ctx) =>
    ctx.db
      .query('tasks')
      .withIndex('by_user_id', (q) =>
        q.eq('userId', 'user_a').eq('id', TASK_ID),
      )
      .first(),
  )
}

const creates = (google: ReturnType<typeof stubGoogle>) =>
  google.mock.calls.filter(([input, init]) => {
    const url = typeof input === 'string' ? input : String(input)
    return (
      url.startsWith(
        'https://www.googleapis.com/calendar/v3/calendars/primary',
      ) && (init?.method ?? 'GET').toUpperCase() === 'POST'
    )
  })

describe('calendar', () => {
  it('a single Resync recreates an event deleted in Google', async () => {
    const t = convexTest(schema, modules)
    await seedSyncedTask(t)
    const google = stubGoogle({ patchStatus: 404 })
    vi.stubGlobal('fetch', google)

    const result = await asUser(t).action(api.calendar.syncTask, {
      taskId: TASK_ID,
    })

    expect(result).toMatchObject({ ok: true, action: 'created' })
    expect((await readTask(t))?.calendarEventId).toBe(DERIVED)
    expect(creates(google)).toHaveLength(1)
  })

  it('leaves the scheduler refusing to resurrect a deleted event', async () => {
    const t = convexTest(schema, modules)
    await seedSyncedTask(t)
    const google = stubGoogle({ patchStatus: 404 })
    vi.stubGlobal('fetch', google)

    const result = await t.action(internal.calendar.syncTaskForUser, {
      userId: 'user_a',
      taskId: TASK_ID,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('event_removed')
    expect(creates(google)).toHaveLength(0)
  })

  it('patches a stored id Google chose itself instead of duplicating it', async () => {
    const t = convexTest(schema, modules)
    await seedSyncedTask(t, { calendarEventId: 'googleChose1' })
    const google = stubGoogle({ patchStatus: 200 })
    vi.stubGlobal('fetch', google)

    const result = await asUser(t).action(api.calendar.syncTask, {
      taskId: TASK_ID,
    })

    expect(result).toMatchObject({ ok: true, action: 'updated' })
    expect((await readTask(t))?.calendarEventId).toBe('googleChose1')
    expect(creates(google)).toHaveLength(0)
  })

  it('deletes the event of a task that no longer wants one, instead of clearing the id', async () => {
    const t = convexTest(schema, modules)
    await seedSyncedTask(t, { done: true })
    const google = stubGoogle({})
    vi.stubGlobal('fetch', google)

    const result = await asUser(t).action(api.calendar.syncTask, {
      taskId: TASK_ID,
    })

    expect(result).toMatchObject({ ok: true, action: 'deleted' })
    const deletes = google.mock.calls.filter(
      ([input, init]) =>
        String(input).startsWith(`${GCAL}/`) &&
        (init?.method ?? 'GET').toUpperCase() === 'DELETE',
    )
    expect(deletes).toHaveLength(1)
    expect((await readTask(t))?.calendarEventId).toBeNull()
  })

  it('turning sync off clears calendarEventId on the task', async () => {
    const t = convexTest(schema, modules)
    await seedSyncedTask(t)
    vi.stubGlobal('fetch', stubGoogle({}))

    await asUser(t).mutation(api.settings.updateCalendarSettings, {
      syncEnabled: false,
    })
    await drainScheduler(t)

    expect((await readTask(t))?.calendarEventId).toBeNull()
  })

  it('keeps the id when Google could not answer the delete', async () => {
    const t = convexTest(schema, modules)
    await seedSyncedTask(t)
    vi.stubGlobal('fetch', stubGoogle({ deleteStatus: 500 }))

    await asUser(t).mutation(api.settings.updateCalendarSettings, {
      syncEnabled: false,
    })
    await drainScheduler(t)

    expect((await readTask(t))?.calendarEventId).toBe(DERIVED)
  })

  it('clears the id when Google says the event was already gone', async () => {
    const t = convexTest(schema, modules)
    await seedSyncedTask(t)
    vi.stubGlobal('fetch', stubGoogle({ deleteStatus: 410 }))

    await asUser(t).mutation(api.settings.updateCalendarSettings, {
      syncEnabled: false,
    })
    await drainScheduler(t)

    expect((await readTask(t))?.calendarEventId).toBeNull()
  })

  it('reports an invalid Clerk secret as a server misconfiguration', async () => {
    const t = convexTest(schema, modules)
    await seedSyncedTask(t, { calendarEventId: null })
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
    if (!result.ok) expect(result.reason).toBe('not_configured')
  })

  it('still reports a missing Google account as the user’s problem', async () => {
    const t = convexTest(schema, modules)
    await seedSyncedTask(t, { calendarEventId: null })
    const calls: Array<string> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        calls.push(url)
        if (url.includes('api.clerk.com'))
          return new Response('{}', { status: 404 })
        return new Response('{}', { status: 500 })
      }),
    )

    const result = await asUser(t).action(api.calendar.syncTask, {
      taskId: TASK_ID,
    })

    expect(calls.filter((u) => u.includes('api.clerk.com'))).toHaveLength(2)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not_connected')
  })
})

describe('eventTimes', () => {
  it('sends a task due at local midnight as an all-day event', () => {
    const midnight = Date.UTC(2026, 9, 14, 23, 0)
    expect(eventTimes(midnight, 'Africa/Lagos')).toEqual({
      start: { date: '2026-10-15', dateTime: null, timeZone: 'Africa/Lagos' },
      end: { date: '2026-10-16', dateTime: null, timeZone: 'Africa/Lagos' },
    })
  })

  it('rolls the all-day end over a month boundary', () => {
    const midnight = Date.UTC(2026, 9, 30, 23, 0)
    expect(eventTimes(midnight, 'Africa/Lagos').end.date).toBe('2026-11-01')
  })

  it('sends a timed task as a one hour block in the user zone', () => {
    const nineThirty = Date.UTC(2026, 9, 15, 8, 30)
    expect(eventTimes(nineThirty, 'Africa/Lagos')).toEqual({
      start: {
        date: null,
        dateTime: '2026-10-15T09:30:00',
        timeZone: 'Africa/Lagos',
      },
      end: {
        date: null,
        dateTime: '2026-10-15T10:30:00',
        timeZone: 'Africa/Lagos',
      },
    })
  })
})
