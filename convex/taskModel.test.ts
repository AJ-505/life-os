import { describe, expect, it } from 'vitest'

import {
  NO_PROJECT_ID,
  applyTaskUpdate,
  descendants,
  newTask,
  taskPatchRow,
  taskRow,
} from './taskModel'

const NOW = Date.UTC(2026, 10, 24, 12)
const clock = { now: NOW, timeZone: 'UTC' }
const MONDAY_NINE = Date.UTC(2026, 10, 23, 9)

const task = (overrides: Partial<Parameters<typeof newTask>[0]> = {}) =>
  newTask(
    {
      id: 't1',
      projectId: 'p1',
      spaceId: null,
      title: 'Task',
      position: 1024,
      ...overrides,
    },
    NOW,
  )

describe('newTask', () => {
  it('trims the title and clamps the duration', () => {
    const made = task({ title: '  Write  ', durationMinutes: 2 })
    expect(made.title).toBe('Write')
    expect(made.durationMinutes).toBe(5)
    expect(task({ durationMinutes: 5000 }).durationMinutes).toBe(1440)
  })

  it('starts open, unscheduled and out of focus', () => {
    expect(task()).toMatchObject({
      done: false,
      doneAt: null,
      archived: false,
      dueAt: null,
      repeat: null,
      inFocus: false,
      calendarSyncIssue: null,
      createdAt: NOW,
    })
  })

  it('stores a loose task with no project and no sync issue field', () => {
    const row = taskRow(task({ projectId: NO_PROJECT_ID }), 'user_a')
    expect(row.projectId).toBeNull()
    expect(row.userId).toBe('user_a')
    expect('calendarSyncIssue' in row).toBe(false)
  })
})

describe('applyTaskUpdate', () => {
  it('rolls a weekly series forward instead of closing it', () => {
    const series = {
      ...task({ dueAt: MONDAY_NINE }),
      repeat: 'weekly' as const,
    }
    expect(applyTaskUpdate(series, { done: true }, clock)).toEqual({
      dueAt: Date.UTC(2026, 10, 30, 9),
      done: false,
      doneAt: null,
    })
  })

  it('uses the repeat rule sent in the same update', () => {
    const plain = task({ dueAt: MONDAY_NINE })
    expect(
      applyTaskUpdate(plain, { done: true, repeat: 'daily' }, clock),
    ).toMatchObject({ dueAt: Date.UTC(2026, 10, 25, 9), done: false })
  })

  it('closes a one-off task with a timestamp', () => {
    expect(applyTaskUpdate(task(), { done: true }, clock)).toEqual({
      done: true,
      doneAt: NOW,
    })
  })

  it('clears the repeat rule with the date', () => {
    const series = {
      ...task({ dueAt: MONDAY_NINE }),
      repeat: 'weekly' as const,
    }
    expect(applyTaskUpdate(series, { dueAt: null }, clock)).toEqual({
      dueAt: null,
      repeat: null,
    })
  })

  it('trims the title and ignores a blank one', () => {
    expect(applyTaskUpdate(task(), { title: '  New  ' }, clock)).toEqual({
      title: 'New',
    })
    expect(applyTaskUpdate(task(), { title: '   ' }, clock)).toEqual({})
  })

  it('clamps the duration', () => {
    expect(applyTaskUpdate(task(), { durationMinutes: 3 }, clock)).toEqual({
      durationMinutes: 5,
    })
  })

  it('clears a sync issue when Add to calendar turns on', () => {
    expect(applyTaskUpdate(task(), { addToCalendar: true }, clock)).toEqual({
      addToCalendar: true,
      calendarSyncIssue: null,
    })
  })
})

describe('taskPatchRow', () => {
  it('stores a cleared sync issue as an unset field', () => {
    expect(taskPatchRow({ calendarSyncIssue: null })).toEqual({
      calendarSyncIssue: undefined,
    })
    expect(taskPatchRow({ title: 'x' })).toEqual({ title: 'x' })
  })
})

describe('descendants', () => {
  const node = (id: string, parentId: string | null) => ({ id, parentId })

  it('finds every level below the root, not the root', () => {
    const tasks = [
      node('a', null),
      node('b', 'a'),
      node('c', 'b'),
      node('d', null),
    ]
    expect(descendants(tasks, 'a').map((t) => t.id)).toEqual(['b', 'c'])
  })

  it('stops on a parent cycle', () => {
    const tasks = [node('a', 'b'), node('b', 'a')]
    expect(descendants(tasks, 'a').map((t) => t.id)).toEqual(['b'])
    expect(descendants(tasks, 'b').map((t) => t.id)).toEqual(['a'])
  })

  it('stops a cycle from swallowing a real subtask', () => {
    const tasks = [node('a', 'b'), node('b', 'a'), node('real', 'b')]
    expect(
      descendants(tasks, 'a')
        .map((t) => t.id)
        .sort(),
    ).toEqual(['b', 'real'])
  })
})
