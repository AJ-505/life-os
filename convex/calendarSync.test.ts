import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from './_generated/api'
import { fakeGoogle } from './google.fake'
import schema from './schema'

import type { TestConvex } from 'convex-test'

const modules = import.meta.glob([
  './**/*.ts',
  '!./**/*.test.ts',
  '!./test.setup.ts',
])

type T = TestConvex<typeof schema>

const asUser = (t: T) => t.withIdentity({ subject: 'user_a' })

const TASK_ID = 'abcdef12-3456-7890-abcd-ef1234567890'
const EVENT_ID = 'abcdef1234567890abcdef1234567890'
const DUE = Date.UTC(2026, 0, 2, 9)

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers)

async function seed(
  t: T,
  settings: { syncEnabled: boolean; autoAdd: boolean },
  task: { addToCalendar?: boolean; calendarEventId?: string; dueAt?: number | null } = {},
) {
  await t.run(async (ctx) => {
    await ctx.db.insert('userSettings', {
      userId: 'user_a',
      calendarSyncEnabled: settings.syncEnabled,
      autoAddToCalendar: settings.autoAdd,
      defaultReminderMinutes: 15,
      timeZone: 'UTC',
      createdAt: 1,
      updatedAt: 1,
    })
    await ctx.db.insert('tasks', {
      userId: 'user_a',
      id: TASK_ID,
      projectId: null,
      parentId: null,
      title: 'Task',
      notes: null,
      position: 1,
      done: false,
      doneAt: null,
      archived: false,
      dueAt: task.dueAt === undefined ? DUE : task.dueAt,
      addToCalendar: task.addToCalendar ?? false,
      calendarEventId: task.calendarEventId ?? null,
      inFocus: false,
      focusOrder: 0,
      createdAt: 1,
      spaceId: null,
    })
  })
}

const readTask = (t: T) =>
  t.run(async (ctx) =>
    ctx.db
      .query('tasks')
      .withIndex('by_user_id', (q) => q.eq('userId', 'user_a').eq('id', TASK_ID))
      .first(),
  )

describe('calendar sync rules from docs/statecharts/CalendarSync', () => {
  it('RateLimitIsRetried: a rate limited edit is pushed again', async () => {
    const t = convexTest(schema, modules)
    await seed(t, { syncEnabled: true, autoAdd: true }, { dueAt: null })
    const google = fakeGoogle()
    google.refuse('POST', 429, 2)
    vi.stubGlobal('fetch', google.fetch)

    await asUser(t).mutation(api.tracker.updateTask, { id: TASK_ID, dueAt: DUE })
    await settle(t)

    expect(google.count('POST')).toBe(3)
    expect(google.events.has(EVENT_ID)).toBe(true)
    const task = await readTask(t)
    expect(task?.calendarEventId).toBe(EVENT_ID)
    expect(task?.calendarSyncIssue).toBeUndefined()
  })

  it('WantedEventArrives: turning sync on adds a task switched to the calendar', async () => {
    const t = convexTest(schema, modules)
    await seed(t, { syncEnabled: false, autoAdd: false }, { addToCalendar: true })
    const google = fakeGoogle()
    vi.stubGlobal('fetch', google.fetch)

    await asUser(t).mutation(api.settings.updateCalendarSettings, {
      syncEnabled: true,
    })
    await settle(t)

    expect(google.events.has(EVENT_ID)).toBe(true)
    expect((await readTask(t))?.calendarEventId).toBe(EVENT_ID)
  })

  it('UnwantedEventLeaves: a refused cleanup retries, then marks the task', async () => {
    const t = convexTest(schema, modules)
    await seed(
      t,
      { syncEnabled: true, autoAdd: false },
      { addToCalendar: true, calendarEventId: EVENT_ID },
    )
    const google = fakeGoogle()
    google.events.set(EVENT_ID, { id: EVENT_ID })
    google.refuse('DELETE', 503)
    vi.stubGlobal('fetch', google.fetch)

    await asUser(t).mutation(api.settings.updateCalendarSettings, {
      syncEnabled: false,
    })
    await settle(t)

    expect(google.count('DELETE')).toBe(4)
    const task = await readTask(t)
    expect(task?.calendarEventId).toBe(EVENT_ID)
    expect(task?.calendarSyncIssue).toBe('google_error')
  })

  it('a refused cleanup that recovers leaves no event and no mark', async () => {
    const t = convexTest(schema, modules)
    await seed(
      t,
      { syncEnabled: true, autoAdd: false },
      { addToCalendar: true, calendarEventId: EVENT_ID },
    )
    const google = fakeGoogle()
    google.events.set(EVENT_ID, { id: EVENT_ID })
    google.refuse('DELETE', 429, 1)
    vi.stubGlobal('fetch', google.fetch)

    await asUser(t).mutation(api.settings.updateCalendarSettings, {
      syncEnabled: false,
    })
    await settle(t)

    expect(google.events.has(EVENT_ID)).toBe(false)
    const task = await readTask(t)
    expect(task?.calendarEventId).toBeNull()
    expect(task?.calendarSyncIssue).toBeUndefined()
  })
})

describe('repairCalendar', () => {
  it('pushes every synced task and reports the result', async () => {
    const t = convexTest(schema, modules)
    await seed(t, { syncEnabled: true, autoAdd: false }, { addToCalendar: true })
    const google = fakeGoogle()
    vi.stubGlobal('fetch', google.fetch)

    const summary = await asUser(t).action(api.calendar.repairCalendar, {})

    expect(summary).toEqual({ total: 1, updated: 1, failed: 0, reason: null })
    expect(google.events.has(EVENT_ID)).toBe(true)
  })

  it('names the most common failure', async () => {
    const t = convexTest(schema, modules)
    await seed(t, { syncEnabled: true, autoAdd: false }, { addToCalendar: true })
    vi.stubGlobal('fetch', fakeGoogle({ connected: false }).fetch)

    const summary = await asUser(t).action(api.calendar.repairCalendar, {})

    expect(summary).toEqual({
      total: 1,
      updated: 0,
      failed: 1,
      reason: 'not_connected',
    })
  })
})
