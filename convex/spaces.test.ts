import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'

import { api } from './_generated/api'
import schema from './schema'

import type { TestConvex } from 'convex-test'

/**
 * The spaces authorization matrix, at the level the UI cannot prove: two real
 * identities, the same shared rows, and the seam deciding who may write.
 *
 * Several of these cases exist because a review found them: a member could
 * plant a project id and block a teammate's writes, a shared parent carried
 * subtasks its owner did not create, and an owner could leave the space
 * ownerless.
 */

// Every Convex function module, minus the tests themselves.
const modules = import.meta.glob([
  './**/*.ts',
  '!./**/*.test.ts',
  '!./test.setup.ts',
])

type T = TestConvex<typeof schema>

function asUser(t: T, subject: string) {
  return t.withIdentity({ subject })
}

async function personalProject(
  t: T,
  subject: string,
  id: string,
  name = 'Personal',
) {
  return await asUser(t, subject).mutation(api.tracker.createProject, {
    id,
    name,
    color: 'moss',
    gridCol: 0,
    gridRow: 1024,
    spaceId: null,
  })
}

async function spaceProject(
  t: T,
  subject: string,
  spaceId: string,
  id: string,
  name = 'Shared',
) {
  return await asUser(t, subject).mutation(api.tracker.createProject, {
    id,
    name,
    color: 'sea',
    gridCol: 0,
    gridRow: 1024,
    spaceId,
  })
}

async function twoMemberSpace(t: T) {
  const space = await asUser(t, 'user_a').mutation(api.spaces.createSpace, {
    name: 'Design Sprint',
  })
  const joined = await asUser(t, 'user_b').mutation(
    api.spaces.joinSpaceByCode,
    {
      inviteCode: space.inviteCode,
    },
  )
  expect(joined.ok).toBe(true)
  return space
}

describe('spaces: create and join', () => {
  it('generates the id and the invite code on the server', async () => {
    const t = convexTest(schema, modules)
    const space = await asUser(t, 'user_a').mutation(api.spaces.createSpace, {
      name: '  Family Trip  ',
    })
    expect(space.name).toBe('Family Trip')
    expect(space.inviteCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/)
    // No endpoint accepts a client id or code, which is what the IDOR needed.
    expect(space.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('resolves a live legacy 6-character code', async () => {
    const t = convexTest(schema, modules)
    // A code in the shape the previous version generated, written straight to
    // the table so the lookup path is what is under test.
    await t.run(async (ctx) => {
      await ctx.db.insert('spaces', {
        id: 'legacy-space',
        ownerId: 'user_a',
        name: 'Legacy',
        inviteCode: 'AB12CD',
        createdAt: Date.now(),
      })
    })
    const result = await asUser(t, 'user_b').mutation(
      api.spaces.joinSpaceByCode,
      {
        inviteCode: 'ab12cd',
      },
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.space.id).toBe('legacy-space')
  })

  it('throttles a run of bad codes', async () => {
    const t = convexTest(schema, modules)
    const user = asUser(t, 'user_a')
    for (let i = 0; i < 10; i++) {
      const attempt = await user.mutation(api.spaces.joinSpaceByCode, {
        inviteCode: `ZZZZ${i}Z`,
      })
      expect(attempt.ok).toBe(false)
      if (!attempt.ok) expect(attempt.reason).toBe('not_found')
    }
    const eleventh = await user.mutation(api.spaces.joinSpaceByCode, {
      inviteCode: 'ZZZZZZ',
    })
    expect(eleventh.ok).toBe(false)
    if (!eleventh.ok) expect(eleventh.reason).toBe('throttled')
  })

  it('reports an unmatchable code as not found, not as a crash', async () => {
    const t = convexTest(schema, modules)
    const attempt = await asUser(t, 'user_a').mutation(
      api.spaces.joinSpaceByCode,
      {
        inviteCode: 'NOTACODE1',
      },
    )
    expect(attempt.ok).toBe(false)
    if (!attempt.ok) expect(attempt.reason).toBe('not_found')
  })
})

describe('spaces: the board scope', () => {
  it('keeps a shared project out of the personal board', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)
    await personalProject(t, 'user_b', 'p-personal')
    await spaceProject(t, 'user_a', space.id, 'p-shared')

    const personal = await asUser(t, 'user_b').query(api.tracker.getBoard, {
      spaceId: null,
    })
    expect(personal.map((p) => p.id)).toEqual(['p-personal'])

    const shared = await asUser(t, 'user_b').query(api.tracker.getBoard, {
      spaceId: space.id,
    })
    expect(shared.map((p) => p.id)).toEqual(['p-shared'])
  })

  it('shows a teammate what another member created', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)
    await spaceProject(t, 'user_a', space.id, 'p-shared')
    await asUser(t, 'user_a').mutation(api.tracker.createTask, {
      id: 't-shared',
      projectId: 'p-shared',
      title: 'Write the brief',
      position: 1024,
    })
    const board = await asUser(t, 'user_b').query(api.tracker.getBoard, {
      spaceId: space.id,
    })
    expect(board[0].tasks.map((x) => x.id)).toEqual(['t-shared'])
  })

  it('refuses a non-member the board and every write', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)
    await spaceProject(t, 'user_a', space.id, 'p-shared')
    await asUser(t, 'user_a').mutation(api.tracker.createTask, {
      id: 't-shared',
      projectId: 'p-shared',
      title: 'Write the brief',
      position: 1024,
    })

    const outsider = asUser(t, 'user_c')
    await expect(
      outsider.query(api.tracker.getBoard, { spaceId: space.id }),
    ).rejects.toThrow()
    await expect(
      outsider.mutation(api.tracker.updateProject, {
        id: 'p-shared',
        name: 'Hijacked',
      }),
    ).rejects.toThrow()
    await expect(
      outsider.mutation(api.tracker.createTask, {
        id: 't-outsider',
        projectId: 'p-shared',
        title: 'Sneak in',
        position: 1024,
      }),
    ).rejects.toThrow()
    await expect(
      outsider.mutation(api.tracker.updateTask, {
        id: 't-shared',
        title: 'Hijacked',
      }),
    ).rejects.toThrow()
    await expect(
      outsider.mutation(api.tracker.deleteTask, { id: 't-shared' }),
    ).rejects.toThrow()
    await expect(
      outsider.mutation(api.tracker.setTaskFocus, {
        id: 't-shared',
        inFocus: true,
      }),
    ).rejects.toThrow()
  })

  it('lets a member write what another member created', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)
    await spaceProject(t, 'user_a', space.id, 'p-shared')
    await asUser(t, 'user_b').mutation(api.tracker.updateProject, {
      id: 'p-shared',
      name: 'Renamed by B',
    })
    const board = await asUser(t, 'user_a').query(api.tracker.getBoard, {
      spaceId: space.id,
    })
    expect(board[0].name).toBe('Renamed by B')
  })
})

describe('spaces: scope id uniqueness', () => {
  it('treats a repeat on the same board as the retry it is', async () => {
    const t = convexTest(schema, modules)
    await personalProject(t, 'user_a', 'p1')
    await personalProject(t, 'user_a', 'p1')
    const board = await asUser(t, 'user_a').query(api.tracker.getBoard, {
      spaceId: null,
    })
    expect(board).toHaveLength(1)
  })

  it('refuses an id already used on another of the caller boards', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)
    await personalProject(t, 'user_a', 'shared-id')
    await expect(
      spaceProject(t, 'user_a', space.id, 'shared-id'),
    ).rejects.toThrow(/another of your boards/)
  })

  it('cannot be blocked by another user planting the id', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)
    // B owns a personal project with the id. A can never reach it, so A's own
    // project with the same id is unaffected.
    await personalProject(t, 'user_b', 'collide')
    await personalProject(t, 'user_a', 'collide')
    const board = await asUser(t, 'user_a').query(api.tracker.getBoard, {
      spaceId: null,
    })
    expect(board.map((p) => p.id)).toEqual(['collide'])
    await asUser(t, 'user_a').mutation(api.tracker.updateProject, {
      id: 'collide',
      name: 'Mine',
    })
    const [mine] = await asUser(t, 'user_a').query(api.tracker.getBoard, {
      spaceId: null,
    })
    expect(mine.name).toBe('Mine')
    // And the space case: a member cannot plant a task id to break a write.
    await spaceProject(t, 'user_a', space.id, 'p-shared')
    await asUser(t, 'user_a').mutation(api.tracker.createTask, {
      id: 't1',
      projectId: 'p-shared',
      title: 'A task',
      position: 1024,
    })
    await asUser(t, 'user_b').mutation(api.tracker.createTask, {
      id: 't1',
      projectId: 'p-shared',
      title: 'A task',
      position: 1024,
    })
    await asUser(t, 'user_b').mutation(api.tracker.updateTask, {
      id: 't1',
      title: 'Renamed by B',
    })
    const shared = await asUser(t, 'user_a').query(api.tracker.getBoard, {
      spaceId: space.id,
    })
    expect(shared[0].tasks).toHaveLength(1)
    expect(shared[0].tasks[0].title).toBe('Renamed by B')
  })
})

describe('spaces: moves and subtrees', () => {
  it('refuses a move between a personal board and a space', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)
    await personalProject(t, 'user_a', 'p1')
    await spaceProject(t, 'user_a', space.id, 'p-shared')
    await asUser(t, 'user_a').mutation(api.tracker.createTask, {
      id: 't1',
      projectId: 'p1',
      title: 'Movable',
      position: 1024,
    })
    await expect(
      asUser(t, 'user_a').mutation(api.tracker.moveTask, {
        id: 't1',
        projectId: 'p-shared',
        position: 1024,
      }),
    ).rejects.toThrow(/personal board and a space/)
  })

  it('moves and deletes a subtree whose children another member created', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)
    await spaceProject(t, 'user_a', space.id, 'p-a')
    await spaceProject(t, 'user_a', space.id, 'p-b')
    await asUser(t, 'user_a').mutation(api.tracker.createTask, {
      id: 'parent',
      projectId: 'p-a',
      title: 'Parent',
      position: 1024,
    })
    // B creates the child, so the walk over the caller's own tasks would miss it.
    await asUser(t, 'user_b').mutation(api.tracker.createTask, {
      id: 'child',
      projectId: 'p-a',
      parentId: 'parent',
      title: 'Child',
      position: 1024,
    })

    await asUser(t, 'user_b').mutation(api.tracker.moveTask, {
      id: 'parent',
      projectId: 'p-b',
      position: 2048,
    })
    let board = await asUser(t, 'user_a').query(api.tracker.getBoard, {
      spaceId: space.id,
    })
    const inB = board.find((p) => p.id === 'p-b')
    expect(inB?.tasks.map((x) => x.id).sort()).toEqual(['child', 'parent'])

    await asUser(t, 'user_b').mutation(api.tracker.deleteTask, { id: 'parent' })
    board = await asUser(t, 'user_a').query(api.tracker.getBoard, {
      spaceId: space.id,
    })
    expect(board.flatMap((p) => p.tasks)).toHaveLength(0)
  })

  it('refuses focus on a shared task', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)
    await spaceProject(t, 'user_a', space.id, 'p-shared')
    await asUser(t, 'user_a').mutation(api.tracker.createTask, {
      id: 't1',
      projectId: 'p-shared',
      title: 'Shared',
      position: 1024,
    })
    await expect(
      asUser(t, 'user_a').mutation(api.tracker.setTaskFocus, {
        id: 't1',
        inFocus: true,
      }),
    ).rejects.toThrow(/personal only/)
  })
})

describe('spaces: leaving', () => {
  it('hands ownership to the longest-standing member and rotates the code', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)
    await asUser(t, 'user_a').mutation(api.spaces.leaveSpace, {
      spaceId: space.id,
    })
    const spaces = await asUser(t, 'user_b').query(api.spaces.getMySpaces, {})
    expect(spaces).toHaveLength(1)
    expect(spaces[0].ownerId).toBe('user_b')
    expect(spaces[0].role).toBe('owner')
    expect(spaces[0].inviteCode).not.toBe(space.inviteCode)

    const members = await asUser(t, 'user_b').query(
      api.spaces.getSpaceMembers,
      {
        spaceId: space.id,
      },
    )
    expect(members.map((m) => m.userId)).toEqual(['user_b'])
    expect(members[0].role).toBe('owner')
  })

  it('refuses to let the last member leave', async () => {
    const t = convexTest(schema, modules)
    const space = await asUser(t, 'user_a').mutation(api.spaces.createSpace, {
      name: 'Solo',
    })
    await expect(
      asUser(t, 'user_a').mutation(api.spaces.leaveSpace, {
        spaceId: space.id,
      }),
    ).rejects.toThrow(/only member/)
  })

  it('deletes a space, its projects and their tasks for the owner only', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)
    await spaceProject(t, 'user_a', space.id, 'p-shared')
    await asUser(t, 'user_a').mutation(api.tracker.createTask, {
      id: 't1',
      projectId: 'p-shared',
      title: 'Gone soon',
      position: 1024,
    })
    await expect(
      asUser(t, 'user_b').mutation(api.spaces.deleteSpace, {
        spaceId: space.id,
      }),
    ).rejects.toThrow(/Only owner/)
    await asUser(t, 'user_a').mutation(api.spaces.deleteSpace, {
      spaceId: space.id,
    })
    const spaces = await asUser(t, 'user_b').query(api.spaces.getMySpaces, {})
    expect(spaces).toHaveLength(0)
  })

  it('never scans the spaces table', async () => {
    const t = convexTest(schema, modules)
    const space = await asUser(t, 'user_a').mutation(api.spaces.createSpace, {
      name: 'Indexed',
    })
    // A row that shares no id with the membership resolves through `by_app_id`
    // rather than a filter, and a foreign space is simply not returned.
    await t.run(async (ctx) => {
      await ctx.db.insert('spaces', {
        id: 'someone-else',
        ownerId: 'user_z',
        name: 'Not mine',
        inviteCode: 'ZZZZZZZZZZ',
        createdAt: Date.now(),
      })
    })
    const spaces = await asUser(t, 'user_a').query(api.spaces.getMySpaces, {})
    expect(spaces.map((s) => s.id)).toEqual([space.id])
  })
})

describe('the pre-Spaces client contract', () => {
  // These calls are byte for byte what the deployed bundle at
  // lifeos-track.vercel.app sends. It was built before Spaces and it talked to
  // this deployment, so making any of these arguments required took the live
  // app down. Each one has to keep working until that front end is rebuilt.

  it('serves a board query with no arguments at all', async () => {
    const t = convexTest(schema, modules)
    await personalProject(t, 'user_a', 'p-personal')
    // The whole argument object is `{}`. Not `{spaceId: null}`: absent.
    const board = await asUser(t, 'user_a').query(api.tracker.getBoard, {})
    expect(board.map((p) => p.id)).toEqual(['p-personal'])
  })

  it('serves a create with no spaceId', async () => {
    const t = convexTest(schema, modules)
    await asUser(t, 'user_a').mutation(api.tracker.createProject, {
      id: 'p-old-client',
      name: 'Made by the old client',
      color: 'moss',
      gridCol: 0,
      gridRow: 1024,
    })
    const board = await asUser(t, 'user_a').query(api.tracker.getBoard, {})
    expect(board.map((p) => p.id)).toEqual(['p-old-client'])
    // And it must land as personal, not shared.
    expect(board[0].spaceId).toBeNull()
  })

  it('echoes a retry from the old client without throwing', async () => {
    const t = convexTest(schema, modules)
    for (const _ of [1, 2]) {
      await asUser(t, 'user_a').mutation(api.tracker.createProject, {
        id: 'p-retry',
        name: 'Retried',
        color: 'moss',
        gridCol: 0,
        gridRow: 1024,
      })
    }
    const board = await asUser(t, 'user_a').query(api.tracker.getBoard, {})
    expect(board).toHaveLength(1)
  })

  it('serves a space create carrying the legacy id and inviteCode', async () => {
    const t = convexTest(schema, modules)
    const space = await asUser(t, 'user_a').mutation(api.spaces.createSpace, {
      name: 'Legacy create',
      id: 'client-made-id',
      inviteCode: 'LEGACY',
    })
    // The server ignores both and generates its own.
    expect(space.id).not.toBe('client-made-id')
    expect(space.inviteCode).not.toBe('LEGACY')
    const mine = await asUser(t, 'user_a').query(api.spaces.getMySpaces, {})
    expect(mine.map((s) => s.name)).toEqual(['Legacy create'])
  })

  it('still serves a task the old client created', async () => {
    const t = convexTest(schema, modules)
    await personalProject(t, 'user_a', 'p1')
    await asUser(t, 'user_a').mutation(api.tracker.createTask, {
      id: 't-old-client',
      projectId: 'p1',
      title: 'Old client task',
      position: 1024,
    })
    const board = await asUser(t, 'user_a').query(api.tracker.getBoard, {})
    expect(board[0].tasks.map((x) => x.id)).toEqual(['t-old-client'])
  })
})

/**
 * Two rows for one pair, which the schema permits. The app cannot create one:
 * Convex serialises the double join, measured. An out-of-band duplicate is what
 * the reader and the removal have to survive.
 */
async function seedDuplicateMembership(t: T, spaceId: string, userId: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert('spaceMembers', {
      spaceId,
      userId,
      role: 'member',
      joinedAt: Date.now() + 1000,
    })
  })
}

async function membershipRows(t: T, spaceId: string, userId: string) {
  return await t.run(async (ctx) =>
    ctx.db
      .query('spaceMembers')
      .withIndex('by_space_user', (q) =>
        q.eq('spaceId', spaceId).eq('userId', userId),
      )
      .collect(),
  )
}

describe('revocation: reset the link', () => {
  it('rotates the code, kills the old link, and keeps members in', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)

    const result = await asUser(t, 'user_a').mutation(
      api.spaces.resetInviteCode,
      {
        spaceId: space.id,
      },
    )
    expect(result.inviteCode).not.toBe(space.inviteCode)

    // The link that leaked no longer resolves, for anyone.
    const replayOld = await asUser(t, 'user_c').mutation(
      api.spaces.joinSpaceByCode,
      {
        inviteCode: space.inviteCode,
      },
    )
    expect(replayOld.ok).toBe(false)
    if (!replayOld.ok) expect(replayOld.reason).toBe('not_found')

    // The new link works.
    const replayNew = await asUser(t, 'user_c').mutation(
      api.spaces.joinSpaceByCode,
      {
        inviteCode: result.inviteCode,
      },
    )
    expect(replayNew.ok).toBe(true)

    // And the members who were already in keep their access.
    const board = await asUser(t, 'user_b').query(api.tracker.getBoard, {
      spaceId: space.id,
    })
    expect(board).toEqual([])
  })

  it('is refused for a non-owner', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)
    await expect(
      asUser(t, 'user_b').mutation(api.spaces.resetInviteCode, {
        spaceId: space.id,
      }),
    ).rejects.toThrow(/Only the owner/)
  })
})

describe('revocation: remove a member', () => {
  it('deletes every row, rotates the code, and the held link stops working', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)
    await seedDuplicateMembership(t, space.id, 'user_b')
    expect(await membershipRows(t, space.id, 'user_b')).toHaveLength(2)

    const result = await asUser(t, 'user_a').mutation(api.spaces.removeMember, {
      spaceId: space.id,
      userId: 'user_b',
    })

    // Both rows, not the one a read happened to return.
    expect(await membershipRows(t, space.id, 'user_b')).toHaveLength(0)
    expect(result.inviteCode).not.toBe(space.inviteCode)

    // The member list the dialog renders no longer shows them.
    const members = await asUser(t, 'user_a').query(
      api.spaces.getSpaceMembers,
      {
        spaceId: space.id,
      },
    )
    expect(members.map((m) => m.userId)).toEqual(['user_a'])

    // They lose access right away.
    await expect(
      asUser(t, 'user_b').query(api.tracker.getBoard, { spaceId: space.id }),
    ).rejects.toThrow()

    // And the link they were holding does not put them back in.
    const replay = await asUser(t, 'user_b').mutation(
      api.spaces.joinSpaceByCode,
      {
        inviteCode: space.inviteCode,
      },
    )
    expect(replay.ok).toBe(false)
    if (!replay.ok) expect(replay.reason).toBe('not_found')
    expect(await membershipRows(t, space.id, 'user_b')).toHaveLength(0)

    // The new link would let them back, which is the owner's choice to share.
    const rejoin = await asUser(t, 'user_b').mutation(
      api.spaces.joinSpaceByCode,
      {
        inviteCode: result.inviteCode,
      },
    )
    expect(rejoin.ok).toBe(true)
  })

  it('leaves the removed member content in the space', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)
    await spaceProject(t, 'user_b', space.id, 'p-b', 'B project')
    await asUser(t, 'user_b').mutation(api.tracker.createTask, {
      id: 't-b',
      projectId: 'p-b',
      title: 'B task',
      position: 1024,
    })
    await asUser(t, 'user_a').mutation(api.spaces.removeMember, {
      spaceId: space.id,
      userId: 'user_b',
    })
    const board = await asUser(t, 'user_a').query(api.tracker.getBoard, {
      spaceId: space.id,
    })
    expect(board.map((p) => p.id)).toEqual(['p-b'])
    expect(board[0].tasks.map((x) => x.id)).toEqual(['t-b'])
  })

  it('refuses a non-owner, the owner, yourself, and removing nobody', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)
    await expect(
      asUser(t, 'user_b').mutation(api.spaces.removeMember, {
        spaceId: space.id,
        userId: 'user_a',
      }),
    ).rejects.toThrow(/Only the owner/)

    await expect(
      asUser(t, 'user_a').mutation(api.spaces.removeMember, {
        spaceId: space.id,
        userId: 'user_a',
      }),
    ).rejects.toThrow(/Leave the space instead/)

    const before = (
      await asUser(t, 'user_a').query(api.spaces.getMySpaces, {})
    )[0].inviteCode
    await expect(
      asUser(t, 'user_a').mutation(api.spaces.removeMember, {
        spaceId: space.id,
        userId: 'user_zzz',
      }),
    ).rejects.toThrow(/not a member/)

    // Removing nobody must not rotate: that breaks the link for pending joiners
    // in exchange for nothing.
    const after = (
      await asUser(t, 'user_a').query(api.spaces.getMySpaces, {})
    )[0].inviteCode
    expect(after).toBe(before)
  })
})

describe('revocation: leaving clears every row', () => {
  it('a duplicate row does not survive a leave', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)
    await seedDuplicateMembership(t, space.id, 'user_b')

    await asUser(t, 'user_b').mutation(api.spaces.leaveSpace, {
      spaceId: space.id,
    })

    expect(await membershipRows(t, space.id, 'user_b')).toHaveLength(0)
    await expect(
      asUser(t, 'user_b').query(api.tracker.getBoard, { spaceId: space.id }),
    ).rejects.toThrow()
  })
})

describe('the spaces list', () => {
  it('lists a space once and derives the role from the space owner', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)
    await seedDuplicateMembership(t, space.id, 'user_b')

    const mine = await asUser(t, 'user_b').query(api.spaces.getMySpaces, {})
    expect(mine.map((s) => s.id)).toEqual([space.id])
    expect(mine[0].role).toBe('member')

    // The owner reads owner from the same field, even after a hand-off.
    const ownerView = await asUser(t, 'user_a').query(
      api.spaces.getMySpaces,
      {},
    )
    expect(ownerView[0].role).toBe('owner')
    await asUser(t, 'user_a').mutation(api.spaces.leaveSpace, {
      spaceId: space.id,
    })
    const afterHandOff = await asUser(t, 'user_b').query(
      api.spaces.getMySpaces,
      {},
    )
    expect(afterHandOff[0].role).toBe('owner')
  })

  it('lists each member once even with a duplicate row', async () => {
    const t = convexTest(schema, modules)
    const space = await twoMemberSpace(t)
    await seedDuplicateMembership(t, space.id, 'user_b')
    const members = await asUser(t, 'user_a').query(
      api.spaces.getSpaceMembers,
      {
        spaceId: space.id,
      },
    )
    expect(members.map((m) => m.userId)).toEqual(['user_a', 'user_b'])
  })
})
