import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, internal } from './_generated/api'
import { NO_PROJECT_ID } from './lib'
import schema from './schema'

import type { TestConvex } from 'convex-test'

const modules = import.meta.glob([
  './**/*.ts',
  '!./**/*.test.ts',
  '!./test.setup.ts',
])

type T = TestConvex<typeof schema>

const asUser = (t: T, subject = 'user_a') => t.withIdentity({ subject })

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const DUE = Date.UTC(2026, 10, 5, 9)

async function project(t: T, id: string, spaceId: string | null = null) {
  await asUser(t).mutation(api.tracker.createProject, {
    id,
    name: id,
    color: 'moss',
    gridCol: 0,
    gridRow: 0,
    spaceId,
  })
}

async function loose(t: T, id: string, spaceId: string | null = null) {
  await asUser(t).mutation(api.tracker.createTask, {
    id,
    projectId: NO_PROJECT_ID,
    spaceId,
    title: id,
    position: 1024,
    dueAt: DUE,
  })
}

const boardShape = async (t: T, spaceId: string | null = null) =>
  (await asUser(t).query(api.tracker.getBoard, { spaceId })).map((p) => [
    p.id,
    p.tasks.map((x) => x.id),
  ])

const storedProject = (t: T, id: string) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query('tasks')
      .withIndex('by_user_id', (q) => q.eq('userId', 'user_a').eq('id', id))
      .first()
    return row?.projectId
  })

describe('tasks with no project', () => {
  it('leaves the board without a bucket until a loose task exists', async () => {
    const t = convexTest(schema, modules)
    await project(t, 'p1')
    expect(await boardShape(t)).toEqual([['p1', []]])
  })

  it('stores null and serves the task in a trailing no-project bucket', async () => {
    const t = convexTest(schema, modules)
    await project(t, 'p1')
    await loose(t, 'free')
    expect(await boardShape(t)).toEqual([
      ['p1', []],
      [NO_PROJECT_ID, ['free']],
    ])
    expect(await storedProject(t, 'free')).toBeNull()
    const board = await asUser(t).query(api.tracker.getBoard, {})
    expect(board[1]).toMatchObject({
      name: 'No project',
      status: 'active',
      gridCol: -1,
      spaceId: null,
    })
    expect(board[1].tasks[0].projectId).toBe(NO_PROJECT_ID)
  })

  it('keeps subtasks of a loose task in the bucket', async () => {
    const t = convexTest(schema, modules)
    await loose(t, 'free')
    await asUser(t).mutation(api.tracker.createTask, {
      id: 'child',
      projectId: NO_PROJECT_ID,
      parentId: 'free',
      title: 'child',
      position: 1024,
    })
    expect(await boardShape(t)).toEqual([[NO_PROJECT_ID, ['free', 'child']]])
  })

  it('moves a loose task into a project and back out, subtree included', async () => {
    const t = convexTest(schema, modules)
    await project(t, 'p1')
    await loose(t, 'free')
    await asUser(t).mutation(api.tracker.createTask, {
      id: 'child',
      projectId: NO_PROJECT_ID,
      parentId: 'free',
      title: 'child',
      position: 2048,
    })

    await asUser(t).mutation(api.tracker.moveTask, {
      id: 'free',
      projectId: 'p1',
      position: 1024,
    })
    expect(await boardShape(t)).toEqual([['p1', ['free', 'child']]])

    await asUser(t).mutation(api.tracker.moveTask, {
      id: 'free',
      projectId: NO_PROJECT_ID,
      position: 1024,
    })
    expect(await boardShape(t)).toEqual([
      ['p1', []],
      [NO_PROJECT_ID, ['free', 'child']],
    ])
    expect(await storedProject(t, 'child')).toBeNull()
  })

  it('keeps loose tasks when their former project is deleted', async () => {
    const t = convexTest(schema, modules)
    await project(t, 'p1')
    await loose(t, 'free')
    await asUser(t).mutation(api.tracker.deleteProject, { id: 'p1' })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await boardShape(t)).toEqual([[NO_PROJECT_ID, ['free']]])
  })

  it('puts a loose task on the space board it was made on', async () => {
    const t = convexTest(schema, modules)
    const space = await asUser(t).mutation(api.spaces.createSpace, {
      name: 'Team',
    })
    await loose(t, 'shared', space.id)
    expect(await boardShape(t, space.id)).toEqual([[NO_PROJECT_ID, ['shared']]])
    expect(await boardShape(t)).toEqual([])
  })

  it('refuses a loose task on a space the caller is not in', async () => {
    const t = convexTest(schema, modules)
    const space = await asUser(t).mutation(api.spaces.createSpace, {
      name: 'Team',
    })
    await expect(
      asUser(t, 'user_z').mutation(api.tracker.createTask, {
        id: 'intruder',
        projectId: NO_PROJECT_ID,
        spaceId: space.id,
        title: 'intruder',
        position: 1024,
      }),
    ).rejects.toThrow()
  })

  it('refuses to move a personal loose task into a space project', async () => {
    const t = convexTest(schema, modules)
    const space = await asUser(t).mutation(api.spaces.createSpace, {
      name: 'Team',
    })
    await project(t, 'shared-p', space.id)
    await loose(t, 'mine')
    await expect(
      asUser(t).mutation(api.tracker.moveTask, {
        id: 'mine',
        projectId: 'shared-p',
        position: 1024,
      }),
    ).rejects.toThrow('Tasks cannot move between a personal board and a space')
  })

  it('purges a stale loose calendar task with its subtasks', async () => {
    vi.setSystemTime(DUE + 30 * 24 * 60 * 60 * 1000)
    const t = convexTest(schema, modules)
    await asUser(t).mutation(api.tracker.createTask, {
      id: 'stale',
      projectId: NO_PROJECT_ID,
      title: 'stale',
      position: 1024,
      dueAt: DUE,
      createdFrom: 'calendar',
    })
    await asUser(t).mutation(api.tracker.createTask, {
      id: 'stale-child',
      projectId: NO_PROJECT_ID,
      parentId: 'stale',
      title: 'stale-child',
      position: 1024,
    })
    await loose(t, 'kept')
    await t.mutation(internal.tracker.purgeStaleCalendarTasks, {})
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await boardShape(t)).toEqual([[NO_PROJECT_ID, ['kept']]])
  })

  it('round-trips a loose task through backup export and import', async () => {
    const t = convexTest(schema, modules)
    await loose(t, 'free')
    const backup = await asUser(t).query(api.backup.exportBackup, {})
    expect(backup.tasks.map((x) => [x.id, x.projectId])).toEqual([
      ['free', null],
    ])
    await asUser(t).mutation(api.tracker.deleteTask, { id: 'free' })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await boardShape(t)).toEqual([])
    await asUser(t).mutation(api.backup.importBackup, backup)
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await boardShape(t)).toEqual([[NO_PROJECT_ID, ['free']]])
  })
})
