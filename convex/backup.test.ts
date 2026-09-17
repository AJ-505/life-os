import { convexTest } from 'convex-test'
import { describe, expect, it, vi } from 'vitest'

import { api, internal } from './_generated/api'
import schema from './schema'

import type { TestConvex } from 'convex-test'

/**
 * Backup is the one place where a wrong scope filter loses data silently.
 *
 * The failure it guards against: `importBackup` used to wipe every row the
 * caller owned. Once a member can create tasks inside a teammate's shared
 * project, "every row the caller owns" includes rows that live on someone
 * else's board, so a personal restore would have deleted them from under the
 * other members. It also used to drop the calendar trio, which orphaned the
 * Google events of the rows it replaced.
 */

const modules = import.meta.glob([
  './**/*.ts',
  '!./**/*.test.ts',
  '!./test.setup.ts',
])
const SCOPE = 'https://www.googleapis.com/auth/calendar.events'

type T = TestConvex<typeof schema>

const TASK_ID = '6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8'

function stubGoogle() {
  const calls: Array<{ url: string; method: string }> = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method })
    if (url.includes('api.clerk.com'))
      return Response.json([
        {
          token: 'tok',
          scopes: [SCOPE],
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      ])
    return new Response(null, { status: 204 })
  }) as typeof fetch
  return calls
}

async function settleScheduled(t: T) {
  await t.finishInProgressScheduledFunctions()
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  vi.useRealTimers()
}

function snapshot(overrides: {
  taskId?: string
  calendarEventId?: string | null
  includeCalendarFields?: boolean
}) {
  const taskId = overrides.taskId ?? TASK_ID
  const task: Record<string, unknown> = {
    id: taskId,
    projectId: 'p1',
    parentId: null,
    title: 'Restored',
    notes: null,
    position: 1024,
    done: false,
    doneAt: null,
    archived: false,
    dueAt: '2027-01-15T08:00:00.000Z',
    inFocus: false,
    focusOrder: 0,
    createdAt: '2027-01-01T00:00:00.000Z',
  }
  if (overrides.includeCalendarFields !== false) {
    task.reminderMinutes = 30
    task.addToCalendar = true
    task.calendarEventId = overrides.calendarEventId ?? null
  }
  return {
    app: 'lifeos' as const,
    version: 1,
    exportedAt: '2027-01-01T00:00:00.000Z',
    projects: [
      {
        id: 'p1',
        name: 'Personal',
        color: 'moss',
        status: 'active',
        collapsed: false,
        gridCol: 0,
        gridRow: 1024,
        targetDate: null,
        createdAt: '2027-01-01T00:00:00.000Z',
        finishedAt: null,
        shelvedAt: null,
      },
    ],
    tasks: [task as never],
  }
}

/** A personal task with an event, plus a shared project and task belonging to
 *  the same caller, so the wipe's scope is what is under test. */
async function seed(t: T, options: { liveEventId?: string | null } = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert('projects', {
      userId: 'user_a',
      id: 'p1',
      name: 'Personal',
      color: 'moss',
      status: 'active',
      collapsed: false,
      gridCol: 0,
      gridRow: 1024,
      targetDate: null,
      createdAt: 1,
      finishedAt: null,
      shelvedAt: null,
    })
    await ctx.db.insert('projects', {
      userId: 'user_a',
      id: 'p-shared',
      name: 'Shared',
      color: 'sea',
      status: 'active',
      collapsed: false,
      gridCol: 1024,
      gridRow: 1024,
      targetDate: null,
      createdAt: 1,
      finishedAt: null,
      shelvedAt: null,
      spaceId: 'space-1',
    })
    await ctx.db.insert('tasks', {
      userId: 'user_a',
      id: TASK_ID,
      projectId: 'p1',
      parentId: null,
      title: 'Old',
      notes: null,
      position: 1024,
      done: false,
      doneAt: null,
      archived: false,
      dueAt: 1_800_000_000_000,
      reminderMinutes: 15,
      addToCalendar: true,
      calendarEventId:
        options.liveEventId === undefined ? 'gcal-live' : options.liveEventId,
      inFocus: false,
      focusOrder: 0,
      createdAt: 1,
    })
    await ctx.db.insert('tasks', {
      userId: 'user_a',
      id: 'shared-task',
      projectId: 'p-shared',
      parentId: null,
      title: 'Shared work',
      notes: null,
      position: 1024,
      done: false,
      doneAt: null,
      archived: false,
      dueAt: null,
      inFocus: false,
      focusOrder: 0,
      createdAt: 1,
      spaceId: 'space-1',
    })
  })
}

describe('export', () => {
  it('leaves space rows out', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    const file = await t
      .withIdentity({ subject: 'user_a' })
      .query(api.backup.exportBackup, {})
    expect(file.projects.map((p) => p.id)).toEqual(['p1'])
    expect(file.tasks.map((x) => x.id)).toEqual([TASK_ID])
  })

  it('carries the calendar trio', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    const file = await t
      .withIdentity({ subject: 'user_a' })
      .query(api.backup.exportBackup, {})
    expect(file.tasks[0].reminderMinutes).toBe(15)
    expect(file.tasks[0].addToCalendar).toBe(true)
    expect(file.tasks[0].calendarEventId).toBe('gcal-live')
  })
})

describe('import', () => {
  it('does not touch the shared rows the caller owns', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    stubGoogle()
    await t
      .withIdentity({ subject: 'user_a' })
      .mutation(
        api.backup.importBackup,
        snapshot({ calendarEventId: 'gcal-live' }),
      )

    const shared = await t.run(async (ctx) =>
      ctx.db
        .query('tasks')
        .withIndex('by_user_id', (q) =>
          q.eq('userId', 'user_a').eq('id', 'shared-task'),
        )
        .unique(),
    )
    expect(shared).not.toBeNull()
    const projects = await t.run(async (ctx) =>
      ctx.db.query('projects').collect(),
    )
    expect(projects.some((p) => p.id === 'p-shared')).toBe(true)
    expect(projects.some((p) => p.id === 'p1')).toBe(true)
  })

  it('keeps the event id of a row the snapshot carries', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    await seed(t)
    const calls = stubGoogle()
    await t
      .withIdentity({ subject: 'user_a' })
      .mutation(
        api.backup.importBackup,
        snapshot({ calendarEventId: 'gcal-live' }),
      )
    await settleScheduled(t)
    // The same id came back, so nothing was deleted.
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0)
    const task = await t.run(async (ctx) =>
      ctx.db
        .query('tasks')
        .withIndex('by_user_id', (q) =>
          q.eq('userId', 'user_a').eq('id', TASK_ID),
        )
        .unique(),
    )
    expect(task?.calendarEventId).toBe('gcal-live')
    expect(task?.reminderMinutes).toBe(30)
    expect(task?.addToCalendar).toBe(true)
  })

  it('deletes the live event of a row the snapshot replaces', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    await seed(t)
    const calls = stubGoogle()
    await t
      .withIdentity({ subject: 'user_a' })
      .mutation(
        api.backup.importBackup,
        snapshot({ calendarEventId: 'gcal-other' }),
      )
    await settleScheduled(t)
    const deletes = calls.filter((c) => c.method === 'DELETE')
    expect(deletes).toHaveLength(1)
    expect(deletes[0].url).toContain('gcal-live')
  })

  it('deletes the live event when a pre-change snapshot carries no id', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    await seed(t)
    const calls = stubGoogle()
    // An older backup: the task is present, but the calendar fields are not.
    await t
      .withIdentity({ subject: 'user_a' })
      .mutation(
        api.backup.importBackup,
        snapshot({ includeCalendarFields: false }),
      )
    await settleScheduled(t)
    const deletes = calls.filter((c) => c.method === 'DELETE')
    expect(deletes).toHaveLength(1)
    expect(deletes[0].url).toContain('gcal-live')
    const task = await t.run(async (ctx) =>
      ctx.db
        .query('tasks')
        .withIndex('by_user_id', (q) =>
          q.eq('userId', 'user_a').eq('id', TASK_ID),
        )
        .unique(),
    )
    // The id is gone, the intent is not: a resync can put the event back.
    expect(task?.calendarEventId).toBeNull()
    expect(task?.addToCalendar).toBe(false)
  })

  it('cleans up the derived id of a task the snapshot drops', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    await seed(t, { liveEventId: null })
    const calls = stubGoogle()
    // The snapshot carries a different task id, so the live one is dropped.
    await t.withIdentity({ subject: 'user_a' }).mutation(
      api.backup.importBackup,
      snapshot({
        taskId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        calendarEventId: null,
      }),
    )
    await settleScheduled(t)
    const deletes = calls.filter((c) => c.method === 'DELETE')
    expect(deletes).toHaveLength(1)
    expect(deletes[0].url).toContain(TASK_ID.replace(/-/g, '').toLowerCase())
  })

  it('is scoped to the caller', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    await seed(t)
    stubGoogle()
    await t
      .withIdentity({ subject: 'user_b' })
      .mutation(api.backup.importBackup, {
        ...snapshot({ calendarEventId: null }),
        projects: [],
        tasks: [],
      })
    await settleScheduled(t)
    const left = await t.run(async (ctx) =>
      ctx.db
        .query('tasks')
        .withIndex('by_user_id', (q) =>
          q.eq('userId', 'user_a').eq('id', 'shared-task'),
        )
        .unique(),
    )
    expect(left).not.toBeNull()
  })
})

describe('the internal cleanup surface', () => {
  it('is reachable for a user with no token', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    // No stub: the real network is not what this asserts. It must not throw.
    globalThis.fetch = (async () =>
      new Response(null, { status: 401 })) as unknown as typeof fetch
    await expect(
      t.action(internal.calendar.deleteEventsForUser, {
        userId: 'user_a',
        eventIds: ['gcal-live'],
      }),
      // Convex turns an `undefined` return into `null` over the wire.
    ).resolves.toBeNull()
  })
})
