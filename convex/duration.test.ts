import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from './_generated/api'
import { clampDuration } from './lib'
import schema from './schema'

const modules = import.meta.glob([
  './**/*.ts',
  '!./**/*.test.ts',
  '!./test.setup.ts',
])

describe('clampDuration', () => {
  it('rounds and keeps in-range values', () => {
    expect(clampDuration(90)).toBe(90)
    expect(clampDuration(44.6)).toBe(45)
  })

  it('raises tiny values and caps huge ones', () => {
    expect(clampDuration(0)).toBe(5)
    expect(clampDuration(-30)).toBe(5)
    expect(clampDuration(10_000_000)).toBe(1440)
  })

  it('drops non-finite and absent input', () => {
    expect(clampDuration(Number.NaN)).toBeNull()
    expect(clampDuration(Number.POSITIVE_INFINITY)).toBeNull()
    expect(clampDuration(null)).toBeNull()
    expect(clampDuration(undefined)).toBeNull()
  })
})

const backupTask = (id: string, durationMinutes: number) => ({
  id,
  projectId: 'p1',
  title: id,
  notes: null,
  position: 1,
  done: false,
  doneAt: null,
  archived: false,
  dueAt: null,
  inFocus: false,
  focusOrder: 0,
  createdAt: null,
  durationMinutes,
})

describe('task duration writes', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const as = (t: ReturnType<typeof convexTest>) =>
    t.withIdentity({ subject: 'user_a' })

  it('clamps durations arriving through backup import', async () => {
    const t = convexTest(schema, modules)
    await as(t).mutation(api.backup.importBackup, {
      app: 'lifeos',
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      projects: [],
      tasks: [
        backupTask('nan', Number.NaN),
        backupTask('zero', 0),
        backupTask('huge', 1e9),
        backupTask('ok', 45),
      ],
    })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const rows = await t.run((ctx) => ctx.db.query('tasks').collect())
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.durationMinutes]))
    expect(byId).toEqual({ nan: null, zero: 5, huge: 1440, ok: 45 })
  })

  it('treats NaN from updateTask as no duration', async () => {
    const t = convexTest(schema, modules)
    await t.run((ctx) =>
      ctx.db.insert('tasks', {
        userId: 'user_a',
        id: 'task-1',
        projectId: 'p1',
        parentId: null,
        title: 'T',
        notes: null,
        position: 1,
        done: false,
        doneAt: null,
        archived: false,
        dueAt: null,
        durationMinutes: 30,
        inFocus: false,
        focusOrder: 0,
        createdAt: 1,
        spaceId: null,
      }),
    )
    await as(t).mutation(api.tracker.updateTask, {
      id: 'task-1',
      durationMinutes: Number.NaN,
    })
    const row = await t.run((ctx) => ctx.db.query('tasks').first())
    expect(row?.durationMinutes).toBeNull()
  })
})
