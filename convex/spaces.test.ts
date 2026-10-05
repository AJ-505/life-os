import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from './_generated/api'
import schema from './schema'

import type { TestConvex } from 'convex-test'

/**
 * Spaces regressions found by the 2026-10-03 audit.
 *
 * The `known bugs` block uses `it.fails`: each case states the behaviour we
 * want and is red on purpose, so the suite stays green while the bug is open.
 * When a fix lands the case starts passing, `it.fails` turns that into a
 * failure, and the `.fails` is removed.
 */

const modules = import.meta.glob([
  './**/*.ts',
  '!./**/*.test.ts',
  '!./test.setup.ts',
])

type T = TestConvex<typeof schema>

const asUser = (t: T, subject: string) => t.withIdentity({ subject })

/** The delete cascade hands its work to the scheduler, and draining that queue
 *  is what makes "it finished" an assertion rather than a hope. */
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

/** Run every scheduled function, and anything they schedule, to completion. */
const drainScheduler = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers)

/** A two-member space: `user_a` owns it, `user_b` joined. */
async function twoMemberSpace(t: T) {
  const space = await asUser(t, 'user_a').mutation(api.spaces.createSpace, {
    name: 'Team',
  })
  const joined = await asUser(t, 'user_b').mutation(
    api.spaces.joinSpaceByCode,
    { inviteCode: space.inviteCode },
  )
  expect(joined.ok).toBe(true)
  return space
}

async function sharedProjectAndTask(t: T, spaceId: string) {
  await asUser(t, 'user_a').mutation(api.tracker.createProject, {
    id: 'p1',
    name: 'Shared',
    color: 'moss',
    gridCol: 0,
    gridRow: 0,
    spaceId,
  })
  await asUser(t, 'user_a').mutation(api.tracker.createTask, {
    id: 't1',
    projectId: 'p1',
    title: 'Assigned work',
    position: 1,
    assigneeId: 'user_b',
  })
}

describe('spaces: lifecycle and authorization', () => {
  it('hands the space to the longest-standing member when the owner leaves', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)
    const oldCode = space.inviteCode

    await asUser(t, 'user_a').mutation(api.spaces.leaveSpace, {
      spaceId: space.id,
    })

    const spaces = await asUser(t, 'user_b').query(api.spaces.getMySpaces, {})
    const mine = spaces.find((s) => s.id === space.id)
    expect(mine?.role).toBe('owner')
    expect(mine?.inviteCode).not.toBe(oldCode)

    // The link the leaver held is dead; the rotated one works.
    const joinOld = await asUser(t, 'user_c').mutation(
      api.spaces.joinSpaceByCode,
      { inviteCode: oldCode },
    )
    expect(joinOld.ok).toBe(false)
    const joinNew = await asUser(t, 'user_c').mutation(
      api.spaces.joinSpaceByCode,
      { inviteCode: mine!.inviteCode },
    )
    expect(joinNew.ok).toBe(true)
  })

  it('rejects non-owner admin actions and non-member reads', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)

    await expect(
      asUser(t, 'user_b').mutation(api.spaces.deleteSpace, {
        spaceId: space.id,
      }),
    ).rejects.toThrow()
    await expect(
      asUser(t, 'user_b').mutation(api.spaces.resetInviteCode, {
        spaceId: space.id,
      }),
    ).rejects.toThrow()
    await expect(
      asUser(t, 'user_b').mutation(api.spaces.removeMember, {
        spaceId: space.id,
        userId: 'user_a',
      }),
    ).rejects.toThrow()

    await expect(
      asUser(t, 'user_c').query(api.tracker.getBoard, { spaceId: space.id }),
    ).rejects.toThrow()
    await expect(
      asUser(t, 'user_c').query(api.spaces.getSpaceMembers, {
        spaceId: space.id,
      }),
    ).rejects.toThrow()
  })

  it('throttles after ten failed invite codes', async () => {
    const t = convexTest(schema, modules)
    const reasons: Array<string> = []
    for (let i = 0; i < 10; i++) {
      const result = await asUser(t, 'user_a').mutation(
        api.spaces.joinSpaceByCode,
        { inviteCode: `BADCODE${i}` },
      )
      reasons.push(result.ok ? 'ok' : result.reason)
    }
    expect(reasons.slice(0, 9)).toEqual(Array(9).fill('not_found'))
    expect(reasons[9]).toBe('throttled')
  })
})

describe('spaces: known bugs', () => {
  it('deleteSpace removes the tasks’ activity rows', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)
    await sharedProjectAndTask(t, space.id)

    await asUser(t, 'user_a').mutation(api.spaces.deleteSpace, {
      spaceId: space.id,
    })
    await drainScheduler(t)

    const activity = await t.run(async (ctx) =>
      ctx.db.query('taskActivity').collect(),
    )
    expect(activity).toHaveLength(0)
  })

  it('deleteSpace removes every row the space held, not just the first page', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)
    await sharedProjectAndTask(t, space.id)

    await asUser(t, 'user_a').mutation(api.spaces.deleteSpace, {
      spaceId: space.id,
    })
    await drainScheduler(t)

    // Asserts completion rather than a resolved promise: a cascade that
    // started, deleted the first page and stopped would still resolve.
    const left = await t.run(async (ctx) => ({
      tasks: await ctx.db.query('tasks').collect(),
      projects: await ctx.db.query('projects').collect(),
      members: await ctx.db.query('spaceMembers').collect(),
      activity: await ctx.db.query('taskActivity').collect(),
      spaces: await ctx.db
        .query('spaces')
        .withIndex('by_app_id', (q) => q.eq('id', space.id))
        .collect(),
    }))
    expect(left.tasks).toHaveLength(0)
    expect(left.projects).toHaveLength(0)
    expect(left.members).toHaveLength(0)
    expect(left.activity).toHaveLength(0)
    expect(left.spaces).toHaveLength(0)
  })

  it('finishes a cascade that stopped part way, on a second click', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)
    // More tasks than one page, so the first click cannot finish and really
    // does leave the rest to a continuation.
    await t.run(async (ctx) => {
      for (let i = 0; i < 150; i++) {
        await ctx.db.insert('tasks', {
          userId: 'user_a',
          id: `t${i}`,
          projectId: 'p1',
          parentId: null,
          title: `Task ${i}`,
          notes: null,
          position: i,
          done: false,
          doneAt: null,
          archived: false,
          dueAt: null,
          inFocus: false,
          focusOrder: 0,
          createdAt: 1,
          spaceId: space.id,
        })
      }
    })

    // Click once and let none of its continuation run: the state a pass that
    // died mid-cascade leaves behind.
    await asUser(t, 'user_a').mutation(api.spaces.deleteSpace, {
      spaceId: space.id,
    })
    const midway = await asUser(t, 'user_a').query(api.spaces.getMySpaces, {})
    // Membership survives, so the owner can still reach Delete.
    expect(midway.some((s) => s.id === space.id)).toBe(true)

    // Clicking again is the whole recovery story, and it has to leave nothing.
    await asUser(t, 'user_a').mutation(api.spaces.deleteSpace, {
      spaceId: space.id,
    })
    await drainScheduler(t)

    const left = await t.run(async (ctx) => ({
      tasks: await ctx.db.query('tasks').collect(),
      members: await ctx.db.query('spaceMembers').collect(),
      spaces: await ctx.db
        .query('spaces')
        .withIndex('by_app_id', (q) => q.eq('id', space.id))
        .collect(),
    }))
    expect(left.tasks).toHaveLength(0)
    expect(left.members).toHaveLength(0)
    expect(left.spaces).toHaveLength(0)
  })

  it('removing a member unassigns their tasks', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)
    await sharedProjectAndTask(t, space.id)

    await asUser(t, 'user_a').mutation(api.spaces.removeMember, {
      spaceId: space.id,
      userId: 'user_b',
    })
    await drainScheduler(t)

    const board = await asUser(t, 'user_a').query(api.tracker.getBoard, {
      spaceId: space.id,
    })
    const task = board.flatMap((p) => p.tasks).find((x) => x.id === 't1')
    expect(task?.assigneeId).toBeNull()
  })

  it('leaving a space unassigns the leaver’s tasks too', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)
    await sharedProjectAndTask(t, space.id)

    await asUser(t, 'user_b').mutation(api.spaces.leaveSpace, {
      spaceId: space.id,
    })
    await drainScheduler(t)

    const board = await asUser(t, 'user_a').query(api.tracker.getBoard, {
      spaceId: space.id,
    })
    const task = board.flatMap((p) => p.tasks).find((x) => x.id === 't1')
    expect(task?.assigneeId).toBeNull()
  })

  it('deleteSpace does not read the whole space in one transaction', async () => {
    // Convex caps a transaction at ~32k docs / 16MB read by default. Lower it
    // so the unbounded first read is visible at test scale. Every page is a
    // read and so is every delete of one, so 300 tasks have to go in at least
    // three passes — which is the whole point of the phase machine.
    const t = convexTest({
      schema,
      modules,
      transactionLimits: { documentsRead: 250 },
    })
    const space = await asUser(t, 'user_a').mutation(api.spaces.createSpace, {
      name: 'Big',
    })
    await t.run(async (ctx) => {
      await ctx.db.insert('projects', {
        userId: 'user_a',
        id: 'p1',
        name: 'P',
        color: 'moss',
        status: 'active',
        collapsed: false,
        gridCol: 0,
        gridRow: 0,
        targetDate: null,
        createdAt: 1,
        finishedAt: null,
        shelvedAt: null,
        spaceId: space.id,
      })
      for (let i = 0; i < 300; i++) {
        await ctx.db.insert('tasks', {
          userId: 'user_a',
          id: `t${i}`,
          projectId: 'p1',
          parentId: null,
          title: `Task ${i}`,
          notes: null,
          position: i,
          done: false,
          doneAt: null,
          archived: false,
          dueAt: null,
          inFocus: false,
          focusOrder: 0,
          createdAt: 1,
          spaceId: space.id,
        })
      }
    })

    await asUser(t, 'user_a').mutation(api.spaces.deleteSpace, {
      spaceId: space.id,
    })
    await drainScheduler(t)

    const left = await t.run(async (ctx) => ({
      tasks: await ctx.db.query('tasks').collect(),
      projects: await ctx.db.query('projects').collect(),
    }))
    expect(left.tasks).toHaveLength(0)
    expect(left.projects).toHaveLength(0)
  })
})
