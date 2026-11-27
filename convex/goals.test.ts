import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from './_generated/api'
import { CHECKIN_MERGE_MS } from './goalModel'
import schema from './schema'

import type { TestConvex } from 'convex-test'

const modules = import.meta.glob([
  './**/*.ts',
  '!./**/*.test.ts',
  '!./test.setup.ts',
])

type T = TestConvex<typeof schema>

const asUser = (t: T, subject: string) => t.withIdentity({ subject })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-01T09:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const drainScheduler = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers)

async function goal(
  t: T,
  user: string,
  id: string,
  extra: { target?: number; unit?: string | null; position?: number } = {},
) {
  await asUser(t, user).mutation(api.goals.createGoal, {
    id,
    title: `  ${id}  `,
    color: 'moss',
    target: extra.target ?? 100,
    unit: extra.unit ?? null,
    targetDate: null,
    position: extra.position ?? 1024,
  })
}

const list = (t: T, user: string) => asUser(t, user).query(api.goals.listGoals)

const progress = (t: T, user: string, id: string, value: number) =>
  asUser(t, user).mutation(api.goals.setGoalProgress, { id, value })

const checkinRows = (t: T) =>
  t.run(async (ctx) => ctx.db.query('goalCheckins').collect())

describe('goals', () => {
  it('creates a goal at zero with one starting point, once per id', async () => {
    const t = convexTest(schema, modules)
    await goal(t, 'user_a', 'g1', { target: 24, unit: ' books ' })
    await goal(t, 'user_a', 'g1')

    const [only, ...rest] = await list(t, 'user_a')
    expect(rest).toEqual([])
    expect(only).toMatchObject({
      id: 'g1',
      title: 'g1',
      target: 24,
      unit: 'books',
      current: 0,
      reachedAt: null,
      history: [{ value: 0, at: Date.now() }],
    })
  })

  it('refuses a goal with no title or a target of zero', async () => {
    const t = convexTest(schema, modules)
    const create = (title: string, target: number) =>
      asUser(t, 'user_a').mutation(api.goals.createGoal, {
        id: 'bad',
        title,
        color: 'moss',
        target,
        unit: null,
        targetDate: null,
        position: 0,
      })
    await expect(create('   ', 10)).rejects.toThrow('A goal needs a title')
    await expect(create('Run', 0)).rejects.toThrow('more than zero')
    expect(await list(t, 'user_a')).toEqual([])
  })

  it('clamps progress to the target and marks the goal reached at the top', async () => {
    const t = convexTest(schema, modules)
    await goal(t, 'user_a', 'g1', { target: 24 })

    await progress(t, 'user_a', 'g1', -5)
    expect((await list(t, 'user_a'))[0].current).toBe(0)

    await progress(t, 'user_a', 'g1', 30)
    const reached = (await list(t, 'user_a'))[0]
    expect(reached.current).toBe(24)
    expect(reached.reachedAt).toBe(Date.now())

    vi.advanceTimersByTime(60_000)
    await progress(t, 'user_a', 'g1', 24)
    expect((await list(t, 'user_a'))[0].reachedAt).toBe(reached.reachedAt)

    await progress(t, 'user_a', 'g1', 20)
    expect((await list(t, 'user_a'))[0]).toMatchObject({
      current: 20,
      reachedAt: null,
    })
  })

  it('merges moves made close together into one history point', async () => {
    const t = convexTest(schema, modules)
    await goal(t, 'user_a', 'g1')
    const start = Date.now()

    vi.advanceTimersByTime(CHECKIN_MERGE_MS)
    await progress(t, 'user_a', 'g1', 10)
    vi.advanceTimersByTime(60_000)
    await progress(t, 'user_a', 'g1', 15)
    vi.advanceTimersByTime(60_000)
    await progress(t, 'user_a', 'g1', 18)
    vi.advanceTimersByTime(CHECKIN_MERGE_MS)
    await progress(t, 'user_a', 'g1', 40)

    expect((await list(t, 'user_a'))[0].history).toEqual([
      { value: 0, at: start },
      { value: 18, at: start + CHECKIN_MERGE_MS + 120_000 },
      { value: 40, at: start + 2 * CHECKIN_MERGE_MS + 120_000 },
    ])
  })

  it('keeps the start point when the first move comes right away', async () => {
    const t = convexTest(schema, modules)
    await goal(t, 'user_a', 'g1')
    const start = Date.now()

    vi.advanceTimersByTime(1000)
    await progress(t, 'user_a', 'g1', 62)
    vi.advanceTimersByTime(1000)
    await progress(t, 'user_a', 'g1', 70)

    expect((await list(t, 'user_a'))[0].history).toEqual([
      { value: 0, at: start },
      { value: 70, at: start + 2000 },
    ])
  })

  it('writes nothing when the value does not change', async () => {
    const t = convexTest(schema, modules)
    await goal(t, 'user_a', 'g1')
    vi.advanceTimersByTime(CHECKIN_MERGE_MS * 2)
    await progress(t, 'user_a', 'g1', 0)
    expect(await checkinRows(t)).toHaveLength(1)
  })

  it('keeps each user to their own goals', async () => {
    const t = convexTest(schema, modules)
    await goal(t, 'user_a', 'g1')

    expect(await list(t, 'user_b')).toEqual([])
    await expect(progress(t, 'user_b', 'g1', 50)).rejects.toThrow(
      'Goal not found',
    )
    await expect(
      asUser(t, 'user_b').mutation(api.goals.updateGoal, {
        id: 'g1',
        title: 'Mine now',
      }),
    ).rejects.toThrow('Goal not found')
    await asUser(t, 'user_b').mutation(api.goals.deleteGoal, { id: 'g1' })
    expect(await list(t, 'user_a')).toHaveLength(1)
  })

  it('edits a goal and pulls progress down to a smaller target', async () => {
    const t = convexTest(schema, modules)
    await goal(t, 'user_a', 'g1', { target: 24, unit: 'books' })
    await progress(t, 'user_a', 'g1', 20)

    await asUser(t, 'user_a').mutation(api.goals.updateGoal, {
      id: 'g1',
      title: ' Read 12 books ',
      target: 12,
      unit: '',
      targetDate: Date.UTC(2026, 11, 31),
    })

    expect((await list(t, 'user_a'))[0]).toMatchObject({
      title: 'Read 12 books',
      target: 12,
      unit: null,
      current: 12,
      targetDate: Date.UTC(2026, 11, 31),
    })
  })

  it('reopens a reached goal and orders goals by position', async () => {
    const t = convexTest(schema, modules)
    await goal(t, 'user_a', 'g1', { position: 1024 })
    await goal(t, 'user_a', 'g2', { position: 2048 })
    await progress(t, 'user_a', 'g1', 100)

    await asUser(t, 'user_a').mutation(api.goals.reopenGoal, { id: 'g1' })
    await asUser(t, 'user_a').mutation(api.goals.moveGoal, {
      id: 'g2',
      position: 512,
    })

    const goals = await list(t, 'user_a')
    expect(goals.map((g) => g.id)).toEqual(['g2', 'g1'])
    expect(goals[1]).toMatchObject({ current: 100, reachedAt: null })

    await progress(t, 'user_a', 'g1', 100)
    expect((await list(t, 'user_a'))[1].reachedAt).toBe(Date.now())
  })

  it('deletes a goal with all of its history, in batches', async () => {
    const t = convexTest(schema, modules)
    await goal(t, 'user_a', 'g1')
    await goal(t, 'user_a', 'g2')
    await t.run(async (ctx) => {
      for (let i = 0; i < 1200; i++)
        await ctx.db.insert('goalCheckins', {
          userId: 'user_a',
          goalId: 'g1',
          value: i % 100,
          at: i,
        })
    })

    await asUser(t, 'user_a').mutation(api.goals.deleteGoal, { id: 'g1' })
    await drainScheduler(t)

    expect((await list(t, 'user_a')).map((g) => g.id)).toEqual(['g2'])
    expect((await checkinRows(t)).map((row) => row.goalId)).toEqual(['g2'])
  })
})

describe('goals in a backup', () => {
  const exportBackup = (t: T) =>
    asUser(t, 'user_a').query(api.backup.exportBackup)

  it('restores goals with their history when the file has them', async () => {
    const t = convexTest(schema, modules)
    await goal(t, 'user_a', 'kept', { target: 24, unit: 'books' })
    vi.advanceTimersByTime(CHECKIN_MERGE_MS)
    await progress(t, 'user_a', 'kept', 9)
    const backup = await exportBackup(t)

    await progress(t, 'user_a', 'kept', 20)
    await goal(t, 'user_a', 'added later')
    await asUser(t, 'user_a').mutation(api.backup.importBackup, backup)
    await drainScheduler(t)

    const restored = await list(t, 'user_a')
    expect(restored).toEqual(backup.goals)
    expect(restored.map((g) => g.id)).toEqual(['kept'])
    expect(restored[0].history.map((point) => point.value)).toEqual([0, 9])
  })

  it('leaves goals alone when the file is from before goals', async () => {
    const t = convexTest(schema, modules)
    await goal(t, 'user_a', 'g1')
    const { goals: _goals, ...older } = await exportBackup(t)

    await asUser(t, 'user_a').mutation(api.backup.importBackup, older)
    await drainScheduler(t)

    expect((await list(t, 'user_a')).map((g) => g.id)).toEqual(['g1'])
  })
})
