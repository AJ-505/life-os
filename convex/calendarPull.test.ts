import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, internal } from './_generated/api'
import { externalRows, zonedDayStart } from './calendarPull'
import { taskWantsEvent } from './calendar'
import schema from './schema'

import type { TestConvex } from 'convex-test'

/**
 * Backward integration regressions. Google and Clerk are stubbed at `fetch`,
 * so the assertions run the real decision logic against a live account's
 * *shape*, never a live account.
 */

const modules = import.meta.glob([
  './**/*.ts',
  '!./**/*.test.ts',
  '!./test.setup.ts',
])

type T = TestConvex<typeof schema>

const asUser = (t: T) => t.withIdentity({ subject: 'user_a' })

beforeEach(() => vi.useFakeTimers())

const SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const LIST_URL =
  'https://www.googleapis.com/calendar/v3/calendars/primary/events?'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function seedSettings(t: T, timeZone = 'UTC') {
  await t.run(async (ctx) => {
    await ctx.db.insert('userSettings', {
      userId: 'user_a',
      calendarEnabled: true,
      calendarSyncEnabled: true,
      defaultReminderMinutes: 15,
      timeZone,
      createdAt: 1,
      updatedAt: 1,
    })
  })
}

/** Clerk answers with a valid token; Google's list reply is the test's handle
 *  onto the calendar contents. `tokenPages` leading listings carry a page
 *  token, so a two-page pull is expressible without mutating stub internals. */
function stubCalendar(options: {
  items?: Array<unknown>
  status?: number
  tokenPages?: number
}) {
  let call = 0
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input)
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
    if (url.startsWith('https://www.googleapis.com/calendar')) {
      const listing = {
        items: options.items ?? [],
        ...(call++ < (options.tokenPages ?? 0) && {
          nextPageToken: `page${call}`,
        }),
      }
      return new Response(
        JSON.stringify(
          options.status === undefined
            ? listing
            : { error: { code: options.status } },
        ),
        { status: options.status ?? 200 },
      )
    }
    return new Response('{}', { status: 500 })
  })
}

const listCalled = (google: ReturnType<typeof stubCalendar>) =>
  google.mock.calls.filter(([input]) =>
    String(input).startsWith('https://www.googleapis.com/calendar'),
  )

describe('zonedDayStart', () => {
  it('names local midnight in the requested zone', () => {
    const start = zonedDayStart('2026-10-14', 'Europe/Berlin')
    expect(start).not.toBeNull()
    expect(new Date(start!)).toEqual(new Date('2026-10-14T00:00:00+02:00'))
  })

  it('survives a winter DST-adjacent date', () => {
    const start = zonedDayStart('2026-11-02', 'Europe/Berlin')
    expect(new Date(start!)).toEqual(new Date('2026-11-02T00:00:00+01:00'))
  })

  it('rejects a shape that is not YYYY-MM-DD', () => {
    expect(zonedDayStart('14/10/2026', 'UTC')).toBeNull()
    expect(zonedDayStart('2026-13-01', 'UTC')).toBeNull()
  })
})

describe('externalRows', () => {
  const zone = 'UTC'

  it('keeps a timed event with its parsed window', () => {
    const rows = externalRows(
      [
        {
          id: 'e1',
          summary: 'Standup',
          description: 'Talk about the board',
          start: { dateTime: '2026-10-14T09:00:00+02:00' },
          end: { dateTime: '2026-10-14T09:15:00+02:00' },
          htmlLink: 'https://cal/e1',
        },
      ],
      zone,
    )
    expect(rows).toEqual([
      {
        eventId: 'e1',
        title: 'Standup',
        notes: 'Talk about the board',
        location: null,
        allDay: false,
        start: Date.parse('2026-10-14T09:00:00+02:00'),
        end: Date.parse('2026-10-14T09:15:00+02:00'),
        link: 'https://cal/e1',
      },
    ])
  })

  it('gives an endless event a nominal hour instead of dropping it', () => {
    const rows = externalRows(
      [{ id: 'e1', start: { dateTime: '2026-10-14T09:00:00Z' } }],
      zone,
    )
    expect(rows[0].end - rows[0].start).toBe(60 * 60_000)
    expect(rows[0].title).toBe('(No title)')
  })

  it('reads a bare date as an all-day event in the user zone', () => {
    const rows = externalRows(
      [
        {
          id: 'e2',
          summary: 'Away',
          start: { date: '2026-10-14' },
          end: { date: '2026-10-15' },
        },
      ],
      'Europe/Berlin',
    )
    expect(rows[0].allDay).toBe(true)
    expect(rows[0].end - rows[0].start).toBe(86_400_000)
  })

  it('spans a multi-day all-day event across all its days', () => {
    const rows = externalRows(
      [
        {
          id: 'e3',
          start: { date: '2026-10-14' },
          end: { date: '2026-10-17' },
        },
      ],
      zone,
    )
    expect(rows[0].end - rows[0].start).toBe(3 * 86_400_000)
  })

  it('drops cancelled events and our own pushed ones', () => {
    const rows = externalRows(
      [
        {
          id: 'gone',
          status: 'cancelled',
          start: { dateTime: '2026-10-14T09:00:00Z' },
        },
        {
          id: 'ours',
          start: { dateTime: '2026-10-14T09:00:00Z' },
          extendedProperties: { private: { lifeosTaskId: 'task' } },
        },
      ],
      zone,
    )
    expect(rows).toEqual([])
  })

  it('drops shapes it cannot read rather than guessing', () => {
    const rows = externalRows(
      [
        { noId: true },
        { id: 'noStart' },
        { id: 'badStart', start: { dateTime: 'not a time' } },
      ],
      zone,
    )
    expect(rows).toEqual([])
  })
})

describe('pullExternalEvents', () => {
  const WINDOW = {
    from: Date.parse('2026-10-12T00:00:00Z'),
    to: Date.parse('2026-10-19T00:00:00Z'),
  }

  it('caches the fetched window and prunes what it did not fetch', async () => {
    const t = convexTest(schema, modules)
    await seedSettings(t)
    // A row from an earlier pull that the fresh reply will not contain.
    await t.run(async (ctx) => {
      await ctx.db.insert('calendarEvents', {
        userId: 'user_a',
        eventId: 'stale',
        title: 'Stale',
        notes: null,
        location: null,
        allDay: false,
        start: Date.parse('2026-10-13T09:00:00Z'),
        end: Date.parse('2026-10-13T10:00:00Z'),
        link: null,
        fetchedAt: 0,
      })
    })
    const google = stubCalendar({
      items: [
        {
          id: 'fresh',
          summary: 'Fresh',
          start: { dateTime: '2026-10-14T09:00:00Z' },
          end: { dateTime: '2026-10-14T10:00:00Z' },
        },
      ],
    })
    vi.stubGlobal('fetch', google)

    const result = await asUser(t).action(
      api.calendarPull.pullExternalEvents,
      WINDOW,
    )
    expect(result).toEqual({ ok: true, events: 1 })

    const rows = await asUser(t).query(api.calendarPull.listExternalEvents, {
      from: WINDOW.from - 1,
      to: WINDOW.to,
    })
    expect(rows.map((r) => r.eventId)).toEqual(['fresh'])
  })

  it('carries a page token until the list is exhausted', async () => {
    const t = convexTest(schema, modules)
    await seedSettings(t)
    const google = stubCalendar({
      items: [{ id: 'p1', start: { dateTime: '2026-10-14T09:00:00Z' } }],
      tokenPages: 1,
    })
    vi.stubGlobal('fetch', google)

    const result = await asUser(t).action(
      api.calendarPull.pullExternalEvents,
      WINDOW,
    )
    expect(result).toEqual({ ok: true, events: 2 })
    const listings = listCalled(google)
    expect(listings).toHaveLength(2)
    expect(String(listings[1][0]).includes('pageToken=page1')).toBe(true)
  })

  it('reports an unreadable calendar without a throw', async () => {
    const t = convexTest(schema, modules)
    await seedSettings(t)
    vi.stubGlobal('fetch', stubCalendar({ status: 503 }))

    const result = await asUser(t).action(
      api.calendarPull.pullExternalEvents,
      WINDOW,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('google_error')
  })

  it('refuses to guess when the timezone is unknown yet', async () => {
    const t = convexTest(schema, modules)
    // A settings row without a timezone, the state the first app open creates.
    await t.run(async (ctx) => {
      await ctx.db.insert('userSettings', {
        userId: 'user_a',
        calendarEnabled: true,
        calendarSyncEnabled: true,
        defaultReminderMinutes: 15,
        createdAt: 1,
        updatedAt: 1,
      })
    })
    vi.stubGlobal('fetch', stubCalendar({}))

    const result = await asUser(t).action(
      api.calendarPull.pullExternalEvents,
      WINDOW,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('no_timezone')
  })
})

describe('importEvent', () => {
  const PROJECT_ID = 'p1'

  async function seedProjectAndEvent(t: T) {
    await t.run(async (ctx) => {
      await ctx.db.insert('projects', {
        userId: 'user_a',
        id: PROJECT_ID,
        name: 'Home',
        color: 'moss',
        status: 'active',
        collapsed: false,
        gridCol: 0,
        gridRow: 0,
        targetDate: null,
        createdAt: 1,
        finishedAt: null,
        shelvedAt: null,
        spaceId: null,
      })
      await ctx.db.insert('calendarEvents', {
        userId: 'user_a',
        eventId: 'evt1',
        title: 'Team meeting',
        notes: 'Weekly',
        location: null,
        allDay: false,
        start: Date.UTC(2026, 9, 14, 9, 0),
        end: Date.UTC(2026, 9, 14, 9, 45),
        link: 'https://cal/evt1',
        fetchedAt: 1,
      })
    })
  }

  const call = (t: T, taskId = 'task-1') =>
    asUser(t).mutation(api.calendarPull.importEvent, {
      eventId: 'evt1',
      taskId,
      projectId: PROJECT_ID,
      position: 1024,
    })

  it('copies the event into a task that carries the association', async () => {
    const t = convexTest(schema, modules)
    await seedProjectAndEvent(t)
    await call(t)
    const task = await t.run(async (ctx) =>
      ctx.db
        .query('tasks')
        .withIndex('by_user_id', (q) =>
          q.eq('userId', 'user_a').eq('id', 'task-1'),
        )
        .first(),
    )
    expect(task).toMatchObject({
      title: 'Team meeting',
      notes: 'Weekly',
      dueAt: Date.UTC(2026, 9, 14, 9, 0),
      durationMinutes: 45,
      importedFromEventId: 'evt1',
      done: false,
      spaceId: null,
    })
    // An imported copy must never be pushed back for the same slot.
    expect(
      taskWantsEvent(task!, {
        syncEnabled: true,
        autoAdd: true,
      }),
    ).toBe(false)
  })

  it('is a no-op when the same task id is sent again', async () => {
    const t = convexTest(schema, modules)
    await seedProjectAndEvent(t)
    await call(t)
    await call(t)
    const count = await t.run(
      async (ctx) =>
        (await ctx.db.query('tasks').collect()).filter(
          (r) => r.userId === 'user_a',
        ).length,
    )
    expect(count).toBe(1)
  })

  it('refuses an event the cache no longer holds', async () => {
    const t = convexTest(schema, modules)
    await seedProjectAndEvent(t)
    await expect(
      asUser(t).mutation(api.calendarPull.importEvent, {
        eventId: 'missing',
        taskId: 'task-1',
        projectId: PROJECT_ID,
        position: 0,
      }),
    ).rejects.toThrow(/no longer/)
  })

  it('refuses to import into a shared project', async () => {
    const t = convexTest(schema, modules)
    await seedProjectAndEvent(t)
    await t.run(async (ctx) => {
      await ctx.db.insert('spaces', {
        id: 's1',
        ownerId: 'user_a',
        name: 'Shared',
        inviteCode: 'AAAAAA1111',
        createdAt: 1,
      })
      await ctx.db.insert('spaceMembers', {
        spaceId: 's1',
        userId: 'user_a',
        role: 'owner',
        joinedAt: 1,
      })
      await ctx.db.insert('projects', {
        userId: 'user_a',
        id: 'pShared',
        name: 'Shared project',
        color: 'iris',
        status: 'active',
        collapsed: false,
        gridCol: 1,
        gridRow: 0,
        targetDate: null,
        createdAt: 1,
        finishedAt: null,
        shelvedAt: null,
        spaceId: 's1',
      })
    })
    await expect(
      asUser(t).mutation(api.calendarPull.importEvent, {
        eventId: 'evt1',
        taskId: 'task-2',
        projectId: 'pShared',
        position: 0,
      }),
    ).rejects.toThrow(/personal only/)
  })
})

describe('purgeStaleCache', () => {
  it('drops rows no pull has refreshed for a week and keeps the fresh ones', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert('calendarEvents', {
        userId: 'user_a',
        eventId: 'old',
        title: 'Old',
        notes: null,
        location: null,
        allDay: false,
        start: 1,
        end: 2,
        link: null,
        fetchedAt: Date.now() - 8 * 86_400_000,
      })
      await ctx.db.insert('calendarEvents', {
        userId: 'user_b',
        eventId: 'fresh',
        title: 'Fresh',
        notes: null,
        location: null,
        allDay: false,
        start: 1,
        end: 2,
        link: null,
        fetchedAt: Date.now(),
      })
    })

    await t.mutation(internal.calendarPull.purgeStaleCache, {})
    // The purge self-continues over pages; drain the scheduler.
    await t.finishAllScheduledFunctions(vi.runAllTimers)

    const rows = await t.run(async (ctx) =>
      ctx.db.query('calendarEvents').collect(),
    )
    expect(rows.map((r) => r.eventId)).toEqual(['fresh'])
  })
})
