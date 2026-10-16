import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, internal } from './_generated/api'
import { eventTimes } from './calendar'
import schema from './schema'

import type { TestConvex } from 'convex-test'

/**
 * Calendar regressions found by the 2026-10-03 audit.
 *
 * Google and Clerk are stubbed at `fetch`, so the assertions are on the real
 * decision logic the action runs, not on a live account.
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
const GCAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

/** A real task id shape: the derived Google event id is the uuid without its
 *  hyphens, and only ids of at least five allowed characters map. */
const TASK_ID = 'abcdef12-3456-7890-abcd-ef1234567890'
const DERIVED = 'abcdef1234567890abcdef1234567890'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** The sync-off cleanup is two scheduled hops from the click, so a test that
 *  does not drain the queue is asserting on nothing. */
const drainScheduler = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers)

/** A personal task that already owns a Google event. */
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

/** Clerk answers with a valid token; Google's per-verb status is settable, so a
 *  test can say "the delete failed" without saying anything about a live
 *  account. */
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
      const sent = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
      return new Response(
        JSON.stringify({ id: sent.id ?? DERIVED, htmlLink: 'https://cal/x' }),
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
      // A 204 is what Google actually answers a delete with, and the Response
      // constructor forbids a body on it. Sending one throws inside the stub,
      // which the code under test correctly reports as "no reply arrived".
      return new Response(status === 204 ? null : '{}', { status })
    }
    return new Response('{}', { status: 500 })
  })
}

/** The task as stored, so assertions read the database and not the action's
 *  own return value. The id it carries is what the next sync will trust. */
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

/** How many events Google was asked to create. Two means a duplicate. */
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
    // The event is gone on Google's side: every patch is a 404.
    const google = stubGoogle({ patchStatus: 404 })
    vi.stubGlobal('fetch', google)

    const result = await asUser(t).action(api.calendar.syncTask, {
      taskId: TASK_ID,
    })

    expect(result).toMatchObject({ ok: true, action: 'created' })
    // The id is back on the task, not just returned in the result.
    expect((await readTask(t))?.calendarEventId).toBe(DERIVED)
    expect(creates(google)).toHaveLength(1)
  })

  it('leaves the scheduler refusing to resurrect a deleted event', async () => {
    const t = convexTest(schema, modules)
    await seedSyncedTask(t)
    const google = stubGoogle({ patchStatus: 404 })
    vi.stubGlobal('fetch', google)

    // The background path shares every line with Resync except this entry, so
    // this case is what proves the two really do differ.
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
    // Google assigned an id of its own, so the derived one names nothing.
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
    // A done task whose completion-time delete failed, so the id is still the
    // derived one. Resync must remove the event it names, not throw the id away.
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
    // The event is gone from Google, so the id is cleared as a consequence of
    // the delete, not instead of it.
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
    // Draining the queue is what makes the cleared id an assertion and not a
    // hope: the cleanup is two scheduled hops away from the click.
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

    // A server error is not a confirmation. Clearing here would make the next
    // sync create a second event, because nothing would be left to patch.
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
    if (!result.ok) expect(result.reason).toBe('not_configured')
  })

  it('still reports a missing Google account as the user’s problem', async () => {
    const t = convexTest(schema, modules)
    await seedSyncedTask(t, { calendarEventId: null })
    // A 404 means this provider slug is simply not linked, so the other one
    // is worth trying before giving up on the user.
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

    // Both slugs were tried, and neither produced a credential problem.
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
        dateTime: '2026-10-15T09:30:00+01:00',
        timeZone: 'Africa/Lagos',
      },
      end: {
        date: null,
        dateTime: '2026-10-15T10:30:00+01:00',
        timeZone: 'Africa/Lagos',
      },
    })
  })
})

describe('eventTimes across a DST change', () => {
  it('pins the repeated hour to the instant the task names', () => {
    const firstOneThirty = Date.UTC(2026, 10, 1, 5, 30)
    const secondOneThirty = Date.UTC(2026, 10, 1, 6, 30)
    expect(eventTimes(firstOneThirty, 'America/New_York').start.dateTime).toBe(
      '2026-11-01T01:30:00-04:00',
    )
    expect(eventTimes(secondOneThirty, 'America/New_York').start.dateTime).toBe(
      '2026-11-01T01:30:00-05:00',
    )
  })
})

describe('sync issues', () => {
  it('a later edit does not bring back an event deleted in Google', async () => {
    const t = convexTest(schema, modules)
    await seedSyncedTask(t)
    vi.stubGlobal('fetch', stubGoogle({ patchStatus: 404 }))
    await t.action(internal.calendar.syncTaskForUser, {
      userId: 'user_a',
      taskId: TASK_ID,
    })
    expect((await readTask(t))?.calendarSyncIssue).toBe('event_removed')

    const google = stubGoogle({ createStatus: 409 })
    vi.stubGlobal('fetch', google)
    const result = await t.action(internal.calendar.syncTaskForUser, {
      userId: 'user_a',
      taskId: TASK_ID,
    })

    expect(result).toMatchObject({ ok: false, reason: 'event_removed' })
    expect(creates(google)).toHaveLength(0)
  })

  it('Resync clears the removed mark and puts the event back', async () => {
    const t = convexTest(schema, modules)
    await seedSyncedTask(t)
    vi.stubGlobal('fetch', stubGoogle({ patchStatus: 404 }))
    await t.action(internal.calendar.syncTaskForUser, {
      userId: 'user_a',
      taskId: TASK_ID,
    })

    vi.stubGlobal('fetch', stubGoogle({}))
    const result = await asUser(t).action(api.calendar.syncTask, {
      taskId: TASK_ID,
    })

    expect(result).toMatchObject({ ok: true, action: 'created' })
    const task = await readTask(t)
    expect(task?.calendarEventId).toBe(DERIVED)
    expect(task?.calendarSyncIssue).toBeUndefined()
  })

  it('records a background failure on the task and clears it on success', async () => {
    const t = convexTest(schema, modules)
    await seedSyncedTask(t)
    vi.stubGlobal('fetch', stubGoogle({ patchStatus: 500 }))
    await t.action(internal.calendar.syncTaskForUser, {
      userId: 'user_a',
      taskId: TASK_ID,
    })
    expect((await readTask(t))?.calendarSyncIssue).toBe('google_error')

    vi.stubGlobal('fetch', stubGoogle({}))
    await t.action(internal.calendar.syncTaskForUser, {
      userId: 'user_a',
      taskId: TASK_ID,
    })
    expect((await readTask(t))?.calendarSyncIssue).toBeUndefined()
  })
})

const DUE = Date.UTC(2026, 0, 2, 9, 0, 0)

const taskIdFor = (n: number) => `abcdef12-3456-7890-abcd-ef12345678${n}0`

const seedAutoSettings = (
  t: T,
  options: { autoAddToCalendar: boolean; syncEnabled?: boolean },
) =>
  t.run(async (ctx) => {
    await ctx.db.insert('userSettings', {
      userId: 'user_a',
      calendarEnabled: options.syncEnabled ?? true,
      calendarSyncEnabled: options.syncEnabled ?? true,
      autoAddToCalendar: options.autoAddToCalendar,
      defaultReminderMinutes: 15,
      timeZone: 'UTC',
      createdAt: 1,
      updatedAt: 1,
    })
  })

const seedTask = (
  t: T,
  id: string,
  overrides: Partial<{
    addToCalendar: boolean
    calendarEventId: string
    calendarSyncIssue: 'event_removed'
    dueAt: number | null
    spaceId: string | null
  }> = {},
) =>
  t.run(async (ctx) => {
    await ctx.db.insert('tasks', {
      userId: 'user_a',
      id,
      projectId: 'p1',
      parentId: null,
      title: 'Task',
      notes: null,
      position: 1,
      done: false,
      doneAt: null,
      archived: false,
      dueAt: DUE,
      inFocus: false,
      focusOrder: 0,
      createdAt: 1,
      spaceId: null,
      ...overrides,
    })
  })

const readById = (t: T, id: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query('tasks')
      .withIndex('by_user_id', (q) => q.eq('userId', 'user_a').eq('id', id))
      .first(),
  )

const deletes = (google: ReturnType<typeof stubGoogle>) =>
  google.mock.calls.filter(
    ([, init]) => (init?.method ?? 'GET').toUpperCase() === 'DELETE',
  )

describe('auto add to calendar', () => {
  it('turning it on creates events for dated personal tasks without addToCalendar', async () => {
    const t = convexTest(schema, modules)
    await seedAutoSettings(t, { autoAddToCalendar: false })
    await seedTask(t, taskIdFor(1))
    await seedTask(t, taskIdFor(2), { dueAt: null })
    await seedTask(t, taskIdFor(3), { spaceId: 'space_1' })
    const google = stubGoogle({})
    vi.stubGlobal('fetch', google)

    await asUser(t).mutation(api.settings.updateCalendarSettings, {
      autoAddToCalendar: true,
    })
    await drainScheduler(t)

    expect(creates(google)).toHaveLength(1)
    expect((await readById(t, taskIdFor(1)))?.calendarEventId).toBe(
      'abcdef1234567890abcdef12345678' + '10',
    )
    expect((await readById(t, taskIdFor(2)))?.calendarEventId).toBeUndefined()
    expect((await readById(t, taskIdFor(3)))?.calendarEventId).toBeUndefined()
  })

  it('creates an event for a new dated task from quick add', async () => {
    const t = convexTest(schema, modules)
    await seedAutoSettings(t, { autoAddToCalendar: true })
    await t.run(async (ctx) => {
      await ctx.db.insert('projects', {
        userId: 'user_a',
        id: 'p1',
        name: 'P',
        color: 'red',
        status: 'active',
        collapsed: false,
        gridCol: 0,
        gridRow: 0,
        targetDate: null,
        createdAt: 1,
        finishedAt: null,
        shelvedAt: null,
      })
    })
    const google = stubGoogle({})
    vi.stubGlobal('fetch', google)

    await asUser(t).mutation(api.tracker.createTask, {
      id: taskIdFor(1),
      projectId: 'p1',
      title: 'Quick',
      position: 1,
      dueAt: DUE,
    })
    await drainScheduler(t)

    expect(creates(google)).toHaveLength(1)
    expect((await readById(t, taskIdFor(1)))?.calendarEventId).toBeTruthy()
  })

  it('does not create an event for an undated quick add', async () => {
    const t = convexTest(schema, modules)
    await seedAutoSettings(t, { autoAddToCalendar: true })
    await t.run(async (ctx) => {
      await ctx.db.insert('projects', {
        userId: 'user_a',
        id: 'p1',
        name: 'P',
        color: 'red',
        status: 'active',
        collapsed: false,
        gridCol: 0,
        gridRow: 0,
        targetDate: null,
        createdAt: 1,
        finishedAt: null,
        shelvedAt: null,
      })
    })
    const google = stubGoogle({})
    vi.stubGlobal('fetch', google)

    await asUser(t).mutation(api.tracker.createTask, {
      id: taskIdFor(1),
      projectId: 'p1',
      title: 'Quick',
      position: 1,
    })
    await drainScheduler(t)

    expect(creates(google)).toHaveLength(0)
  })

  it('creates an event when a task gains a date', async () => {
    const t = convexTest(schema, modules)
    await seedAutoSettings(t, { autoAddToCalendar: true })
    await seedTask(t, taskIdFor(1), { dueAt: null })
    const google = stubGoogle({})
    vi.stubGlobal('fetch', google)

    await asUser(t).mutation(api.tracker.updateTask, {
      id: taskIdFor(1),
      dueAt: DUE,
    })
    await drainScheduler(t)

    expect(creates(google)).toHaveLength(1)
  })

  it('turning it off deletes only the events auto added', async () => {
    const t = convexTest(schema, modules)
    await seedAutoSettings(t, { autoAddToCalendar: true })
    const autoOnly = 'autoonlyevent1'
    const explicit = 'explicitevent1'
    await seedTask(t, taskIdFor(1), { calendarEventId: autoOnly })
    await seedTask(t, taskIdFor(2), {
      addToCalendar: true,
      calendarEventId: explicit,
    })
    const google = stubGoogle({})
    vi.stubGlobal('fetch', google)

    await asUser(t).mutation(api.settings.updateCalendarSettings, {
      autoAddToCalendar: false,
    })
    await drainScheduler(t)

    expect(deletes(google).map(([url]) => String(url))).toEqual([
      `${GCAL}/${autoOnly}`,
    ])
    expect((await readById(t, taskIdFor(1)))?.calendarEventId).toBeNull()
    expect((await readById(t, taskIdFor(2)))?.calendarEventId).toBe(explicit)
  })

  it('never syncs a space task', async () => {
    const t = convexTest(schema, modules)
    await seedAutoSettings(t, { autoAddToCalendar: true })
    await seedTask(t, taskIdFor(1), { spaceId: 'space_1' })
    const google = stubGoogle({})
    vi.stubGlobal('fetch', google)

    await t.action(internal.calendar.syncTaskForUser, {
      userId: 'user_a',
      taskId: taskIdFor(1),
    })

    expect(creates(google)).toHaveLength(0)
    expect((await readById(t, taskIdFor(1)))?.calendarEventId).toBeUndefined()
  })

  it('respects an event the user removed in Google', async () => {
    const t = convexTest(schema, modules)
    await seedAutoSettings(t, { autoAddToCalendar: false })
    await seedTask(t, taskIdFor(1), { calendarSyncIssue: 'event_removed' })
    const google = stubGoogle({})
    vi.stubGlobal('fetch', google)

    await asUser(t).mutation(api.settings.updateCalendarSettings, {
      autoAddToCalendar: true,
    })
    await drainScheduler(t)

    expect(creates(google)).toHaveLength(0)
    expect((await readById(t, taskIdFor(1)))?.calendarSyncIssue).toBe(
      'event_removed',
    )
  })

  it('does nothing while sync itself is off', async () => {
    const t = convexTest(schema, modules)
    await seedAutoSettings(t, { autoAddToCalendar: false, syncEnabled: false })
    await seedTask(t, taskIdFor(1))
    const google = stubGoogle({})
    vi.stubGlobal('fetch', google)

    await asUser(t).mutation(api.settings.updateCalendarSettings, {
      autoAddToCalendar: true,
    })
    await drainScheduler(t)

    expect(creates(google)).toHaveLength(0)
  })
})
