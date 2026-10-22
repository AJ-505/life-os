import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob([
  './**/*.ts',
  '!./**/*.test.ts',
  '!./test.setup.ts',
])

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 22)

type Overrides = {
  id: string
  dueAt: number | null
  createdFrom?: 'calendar'
  parentId?: string | null
  done?: boolean
}

const task = (o: Overrides) => ({
  userId: 'user_a',
  id: o.id,
  projectId: 'p1',
  parentId: o.parentId ?? null,
  title: o.id,
  notes: null,
  position: 1,
  done: o.done ?? false,
  doneAt: null,
  archived: false,
  dueAt: o.dueAt,
  inFocus: false,
  focusOrder: 0,
  createdAt: 1,
  spaceId: null,
  ...(o.createdFrom && { createdFrom: o.createdFrom }),
})

describe('purgeStaleCalendarTasks', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  async function run(rows: Array<Overrides>) {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      for (const row of rows) await ctx.db.insert('tasks', task(row))
    })
    await t.mutation(internal.tracker.purgeStaleCalendarTasks, {})
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const left = await t.run((ctx) => ctx.db.query('tasks').collect())
    return left.map((r) => r.id).sort()
  }

  it('deletes calendar tasks dated over a week ago, done or not', async () => {
    const left = await run([
      { id: 'old', dueAt: NOW - 8 * DAY, createdFrom: 'calendar' },
      {
        id: 'old-done',
        dueAt: NOW - 30 * DAY,
        createdFrom: 'calendar',
        done: true,
      },
    ])
    expect(left).toEqual([])
  })

  it('keeps calendar tasks that are not yet a week overdue', async () => {
    const left = await run([
      { id: 'recent', dueAt: NOW - 6 * DAY, createdFrom: 'calendar' },
      { id: 'future', dueAt: NOW + 3 * DAY, createdFrom: 'calendar' },
    ])
    expect(left).toEqual(['future', 'recent'])
  })

  it('keeps undated calendar tasks', async () => {
    const left = await run([
      { id: 'undated', dueAt: null, createdFrom: 'calendar' },
    ])
    expect(left).toEqual(['undated'])
  })

  it('never touches tasks that were not made on the calendar', async () => {
    const left = await run([
      { id: 'board-task', dueAt: NOW - 60 * DAY },
      { id: 'board-task-2', dueAt: NOW - 400 * DAY, done: true },
    ])
    expect(left).toEqual(['board-task', 'board-task-2'])
  })

  it('takes the subtasks of a deleted task, not unrelated ones', async () => {
    const left = await run([
      { id: 'old', dueAt: NOW - 9 * DAY, createdFrom: 'calendar' },
      { id: 'child', dueAt: null, parentId: 'old' },
      { id: 'grandchild', dueAt: null, parentId: 'child' },
      { id: 'other', dueAt: null },
    ])
    expect(left).toEqual(['other'])
  })
})
