import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'

import { api } from './_generated/api'
import { NO_PROJECT_ID } from './lib'
import schema from './schema'

import type { TestConvex } from 'convex-test'

const modules = import.meta.glob([
  './**/*.ts',
  '!./**/*.test.ts',
  '!./test.setup.ts',
])

type T = TestConvex<typeof schema>

const asUser = (t: T) => t.withIdentity({ subject: 'user_a' })

async function taskRow(t: T, id: string) {
  return await t.run(async (ctx) =>
    ctx.db
      .query('tasks')
      .withIndex('by_app_id', (q) => q.eq('id', id))
      .unique(),
  )
}

async function seedProject(t: T, id = 'p1') {
  await t.run(async (ctx) => {
    await ctx.db.insert('projects', {
      userId: 'user_a',
      id,
      name: 'Project',
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
  })
}

describe('tasks without a project', () => {
  it('creates a loose task and serves it in the no-project bucket', async () => {
    const t = convexTest(schema, modules)
    await asUser(t).mutation(api.tracker.createTask, {
      id: 't1',
      title: 'Loose',
      position: 1024,
      dueAt: Date.UTC(2026, 0, 2, 9, 0, 0),
    })
    const board = await asUser(t).query(api.tracker.getBoard, { spaceId: null })
    expect(board).toHaveLength(1)
    expect(board[0].id).toBe(NO_PROJECT_ID)
    expect(board[0].tasks.map((x) => x.id)).toEqual(['t1'])
    expect(board[0].tasks[0].projectId).toBe(NO_PROJECT_ID)
  })

  it('treats the no-project id as loose on create', async () => {
    const t = convexTest(schema, modules)
    await asUser(t).mutation(api.tracker.createTask, {
      id: 't1',
      projectId: NO_PROJECT_ID,
      title: 'Loose',
      position: 1024,
    })
    expect((await taskRow(t, 't1'))?.projectId ?? null).toBeNull()
  })

  it('omits the bucket while every task has a project', async () => {
    const t = convexTest(schema, modules)
    await seedProject(t)
    await asUser(t).mutation(api.tracker.createTask, {
      id: 't1',
      projectId: 'p1',
      title: 'T',
      position: 1,
    })
    const board = await asUser(t).query(api.tracker.getBoard, { spaceId: null })
    expect(board.map((p) => p.id)).toEqual(['p1'])
  })

  it('moves a task out of its project and back', async () => {
    const t = convexTest(schema, modules)
    await seedProject(t)
    await asUser(t).mutation(api.tracker.createTask, {
      id: 't1',
      projectId: 'p1',
      title: 'T',
      position: 1,
    })
    await asUser(t).mutation(api.tracker.moveTask, {
      id: 't1',
      projectId: NO_PROJECT_ID,
      position: 1024,
    })
    expect((await taskRow(t, 't1'))?.projectId ?? null).toBeNull()
    const loose = await asUser(t).query(api.tracker.getBoard, { spaceId: null })
    expect(loose.map((p) => p.id)).toEqual([NO_PROJECT_ID])

    await asUser(t).mutation(api.tracker.moveTask, {
      id: 't1',
      projectId: 'p1',
      position: 1,
    })
    expect((await taskRow(t, 't1'))?.projectId).toBe('p1')
    const board = await asUser(t).query(api.tracker.getBoard, { spaceId: null })
    expect(board.map((p) => p.id)).toEqual(['p1'])
  })

  it('keeps a loose space task on the space board', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert('spaces', {
        id: 's1',
        ownerId: 'user_a',
        name: 'Space',
        inviteCode: 'join-s1',
        createdAt: 1,
      })
      await ctx.db.insert('spaceMembers', {
        spaceId: 's1',
        userId: 'user_a',
        role: 'owner',
        joinedAt: 1,
      })
    })
    await asUser(t).mutation(api.tracker.createTask, {
      id: 't1',
      title: 'Shared loose',
      position: 1,
      spaceId: 's1',
    })
    const board = await asUser(t).query(api.tracker.getBoard, { spaceId: 's1' })
    expect(board).toHaveLength(1)
    expect(board[0].id).toBe(NO_PROJECT_ID)
    expect(board[0].spaceId).toBe('s1')
    const personal = await asUser(t).query(api.tracker.getBoard, {
      spaceId: null,
    })
    expect(personal).toHaveLength(0)
  })

  it('rejects a loose space task from a non-member', async () => {
    const t = convexTest(schema, modules)
    await expect(
      t.withIdentity({ subject: 'user_b' }).mutation(api.tracker.createTask, {
        id: 't1',
        title: 'Nope',
        position: 1,
        spaceId: 'missing',
      }),
    ).rejects.toThrow()
  })
})
