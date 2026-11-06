import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from './_generated/api'
import { REPEAT_RULES } from './recurrence'
import schema from './schema'

import type { TestConvex } from 'convex-test'

import type { RepeatRule } from './recurrence'

const modules = import.meta.glob([
  './**/*.ts',
  '!./**/*.test.ts',
  '!./test.setup.ts',
])

type T = TestConvex<typeof schema>

const as = (t: T) => t.withIdentity({ subject: 'user_a' })

type Seed = {
  id?: string
  dueAt: number | null
  repeat?: RepeatRule
  createdFrom?: 'calendar'
  spaceId?: string | null
}

async function seed(t: T, overrides: Seed) {
  const id = overrides.id ?? 'task-1'
  await t.run((ctx) =>
    ctx.db.insert('tasks', {
      userId: 'user_a',
      id,
      projectId: 'p1',
      parentId: null,
      title: id,
      notes: null,
      position: 1,
      done: false,
      doneAt: null,
      archived: false,
      dueAt: overrides.dueAt,
      inFocus: false,
      focusOrder: 0,
      createdAt: 1,
      spaceId: overrides.spaceId ?? null,
      ...(overrides.repeat && { repeat: overrides.repeat }),
      ...(overrides.createdFrom ? { createdFrom: overrides.createdFrom } : {}),
    }),
  )
  return id
}

async function row(t: T, id: string) {
  return await t.run((ctx) =>
    ctx.db
      .query('tasks')
      .withIndex('by_app_id', (q) => q.eq('id', id))
      .first(),
  )
}

const utc = (...parts: [number, number, number, number?]) =>
  Date.UTC(parts[0], parts[1], parts[2], parts[3] ?? 0)

describe('repeating tasks', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(utc(2026, 9, 26, 10))
  })
  afterEach(() => vi.useRealTimers())

  it('rolls a completed occurrence to its next date and stays open', async () => {
    const t = convexTest(schema, modules)
    const id = await seed(t, {
      dueAt: utc(2026, 9, 26, 9),
      repeat: 'weekly',
    })

    await as(t).mutation(api.tracker.updateTask, {
      id,
      done: true,
      timeZone: 'UTC',
    })

    const after = await row(t, id)
    expect(after?.done).toBe(false)
    expect(after?.doneAt).toBeNull()
    expect(after?.dueAt).toBe(utc(2026, 10, 2, 9))
    expect(after?.repeat).toBe('weekly')
  })

  it('skips occurrences already in the past when an overdue task is completed', async () => {
    const t = convexTest(schema, modules)
    const id = await seed(t, {
      dueAt: utc(2026, 9, 20, 9),
      repeat: 'daily',
    })

    await as(t).mutation(api.tracker.updateTask, {
      id,
      done: true,
      timeZone: 'UTC',
    })

    expect((await row(t, id))?.dueAt).toBe(utc(2026, 9, 27, 9))
  })

  it('keeps the wall clock across a daylight saving change', async () => {
    const t = convexTest(schema, modules)
    const id = await seed(t, {
      dueAt: Date.UTC(2026, 9, 24, 8),
      repeat: 'weekly',
    })

    await as(t).mutation(api.tracker.updateTask, {
      id,
      done: true,
      timeZone: 'Europe/London',
    })

    expect((await row(t, id))?.dueAt).toBe(Date.UTC(2026, 9, 31, 9))
  })

  it('closes a one-off task instead of rolling it', async () => {
    const t = convexTest(schema, modules)
    const id = await seed(t, { dueAt: utc(2026, 9, 26, 9) })

    await as(t).mutation(api.tracker.updateTask, { id, done: true })

    const after = await row(t, id)
    expect(after?.done).toBe(true)
    expect(after?.dueAt).toBe(utc(2026, 9, 26, 9))
  })

  it('clears the rule when the date is removed', async () => {
    const t = convexTest(schema, modules)
    const id = await seed(t, {
      dueAt: utc(2026, 9, 26, 9),
      repeat: 'daily',
    })

    await as(t).mutation(api.tracker.updateTask, { id, dueAt: null })

    const after = await row(t, id)
    expect(after?.repeat).toBeNull()
    expect(after?.dueAt).toBeNull()
  })

  it('refuses a rule while the task has no date', async () => {
    const t = convexTest(schema, modules)
    const id = await seed(t, { dueAt: null })

    await as(t).mutation(api.tracker.updateTask, {
      id,
      repeat: 'daily',
      timeZone: 'UTC',
    })

    expect((await row(t, id))?.repeat).toBeNull()
  })

  it('takes a repeating calendar task out of the stale purge index', async () => {
    const t = convexTest(schema, modules)
    const id = await seed(t, {
      dueAt: utc(2026, 9, 26, 9),
      createdFrom: 'calendar',
    })

    await as(t).mutation(api.tracker.updateTask, { id, repeat: 'daily' })

    expect((await row(t, id))?.createdFrom).toBeUndefined()
  })

  it('accepts every rule the calendar renders', async () => {
    const t = convexTest(schema, modules)
    const id = await seed(t, { dueAt: utc(2026, 9, 26, 9) })

    for (const rule of REPEAT_RULES) {
      await as(t).mutation(api.tracker.updateTask, { id, repeat: rule })
      expect((await row(t, id))?.repeat).toBe(rule)
    }
  })
})
