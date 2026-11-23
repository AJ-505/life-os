import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

const asUser = (t: T, subject: string) => t.withIdentity({ subject })

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const drainScheduler = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers)

async function project(
  t: T,
  user: string,
  id: string,
  spaceId: string | null = null,
) {
  await asUser(t, user).mutation(api.tracker.createProject, {
    id,
    name: id,
    color: 'moss',
    gridCol: 0,
    gridRow: 0,
    spaceId,
  })
}

async function sharedSpace(t: T) {
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

const lastProject = (t: T, user: string, spaceId: string | null) =>
  asUser(t, user).query(api.settings.getLastProject, { spaceId })

const choose = (
  t: T,
  user: string,
  spaceId: string | null,
  projectId: string,
) =>
  asUser(t, user).mutation(api.settings.setLastProject, {
    spaceId,
    projectId,
  })

const choiceRows = (t: T) =>
  t.run(async (ctx) => ctx.db.query('lastProjects').collect())

describe('last project', () => {
  it('is null until the user picks one, then follows every pick', async () => {
    const t = convexTest(schema, modules)
    await project(t, 'user_a', 'p1')
    await project(t, 'user_a', 'p2')

    expect(await lastProject(t, 'user_a', null)).toBeNull()
    await choose(t, 'user_a', null, 'p2')
    expect(await lastProject(t, 'user_a', null)).toBe('p2')
    await choose(t, 'user_a', null, NO_PROJECT_ID)
    expect(await lastProject(t, 'user_a', null)).toBe(NO_PROJECT_ID)
    expect(await choiceRows(t)).toHaveLength(1)
  })

  it('keeps one choice per board and per user', async () => {
    const t = convexTest(schema, modules)
    const space = await sharedSpace(t)
    await project(t, 'user_a', 'mine')
    await project(t, 'user_a', 'team', space.id)

    await choose(t, 'user_a', null, 'mine')
    await choose(t, 'user_a', space.id, 'team')

    expect(await lastProject(t, 'user_a', null)).toBe('mine')
    expect(await lastProject(t, 'user_a', space.id)).toBe('team')
    expect(await lastProject(t, 'user_b', space.id)).toBeNull()
    expect(await lastProject(t, 'user_b', null)).toBeNull()
  })

  it('does not write when the pick has not changed', async () => {
    const t = convexTest(schema, modules)
    await project(t, 'user_a', 'p1')
    await choose(t, 'user_a', null, 'p1')
    const [before] = await choiceRows(t)

    vi.advanceTimersByTime(60_000)
    await choose(t, 'user_a', null, 'p1')

    const [after] = await choiceRows(t)
    expect(after.updatedAt).toBe(before.updatedAt)
  })

  it('refuses a project from another board', async () => {
    const t = convexTest(schema, modules)
    const space = await sharedSpace(t)
    await project(t, 'user_a', 'mine')
    await project(t, 'user_a', 'team', space.id)

    await expect(choose(t, 'user_a', space.id, 'mine')).rejects.toThrow(
      'That project is on another board',
    )
    await expect(choose(t, 'user_a', null, 'team')).rejects.toThrow(
      'That project is on another board',
    )
    await expect(choose(t, 'user_b', null, 'mine')).rejects.toThrow(
      'Project not found',
    )
    expect(await choiceRows(t)).toHaveLength(0)
  })

  it('refuses a space the user is not in', async () => {
    const t = convexTest(schema, modules)
    const space = await sharedSpace(t)

    await expect(choose(t, 'user_c', space.id, NO_PROJECT_ID)).rejects.toThrow(
      'Not a member of this space',
    )
  })

  it('forgets the choice when the user leaves the space', async () => {
    const t = convexTest(schema, modules)
    const space = await sharedSpace(t)
    await project(t, 'user_a', 'team', space.id)
    await choose(t, 'user_a', space.id, 'team')
    await choose(t, 'user_b', space.id, 'team')

    await asUser(t, 'user_b').mutation(api.spaces.leaveSpace, {
      spaceId: space.id,
    })

    expect(await lastProject(t, 'user_b', space.id)).toBeNull()
    expect(await lastProject(t, 'user_a', space.id)).toBe('team')
  })

  it('is deleted with the space', async () => {
    const t = convexTest(schema, modules)
    const space = await sharedSpace(t)
    await project(t, 'user_a', 'mine')
    await project(t, 'user_a', 'team', space.id)
    await choose(t, 'user_a', null, 'mine')
    await choose(t, 'user_a', space.id, 'team')
    await choose(t, 'user_b', space.id, NO_PROJECT_ID)

    await asUser(t, 'user_a').mutation(api.spaces.deleteSpace, {
      spaceId: space.id,
    })
    await drainScheduler(t)

    const left = await choiceRows(t)
    expect(left.map((row) => row.spaceId)).toEqual([null])
  })
})
