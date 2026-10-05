import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'

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
  it.fails('deleteSpace removes the tasks’ activity rows', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)
    await sharedProjectAndTask(t, space.id)

    await asUser(t, 'user_a').mutation(api.spaces.deleteSpace, {
      spaceId: space.id,
    })

    const activity = await t.run(async (ctx) =>
      ctx.db.query('taskActivity').collect(),
    )
    // S-1: the cascade passes the task's Convex _id to the activity lookup,
    // which is keyed by the app-facing id, so nothing is deleted.
    expect(activity).toHaveLength(0)
  })

  it.fails('removing a member unassigns their tasks', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)
    await sharedProjectAndTask(t, space.id)

    await asUser(t, 'user_a').mutation(api.spaces.removeMember, {
      spaceId: space.id,
      userId: 'user_b',
    })

    const board = await asUser(t, 'user_a').query(api.tracker.getBoard, {
      spaceId: space.id,
    })
    const task = board.flatMap((p) => p.tasks).find((x) => x.id === 't1')
    // S-3: removeMember drops the membership but leaves assigneeId behind.
    expect(task?.assigneeId).toBeNull()
  })

  it.fails(
    'deleteSpace does not read the whole space in one transaction',
    async () => {
      // Convex caps a transaction at ~32k docs / 16MB read by default. Lower it
      // so the unbounded first read is visible at test scale.
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

      // S-4: deleteSpace .collect()s members, projects and tasks before it
      // batches any delete, so a large space cannot be deleted at all.
      await expect(
        asUser(t, 'user_a').mutation(api.spaces.deleteSpace, {
          spaceId: space.id,
        }),
      ).resolves.toBeUndefined()
    },
  )
})
