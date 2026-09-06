import { describe, expect, it } from 'vitest'

import { focusDrop, focusTasks } from './board-logic'

import type { BoardData } from '../types'

function task(id: string, projectId: string, over: object = {}) {
  return {
    id,
    projectId,
    parentId: null,
    title: id,
    notes: null,
    position: 1024,
    done: false,
    doneAt: null,
    archived: false,
    dueAt: null,
    reminderMinutes: null,
    addToCalendar: false,
    calendarEventId: null,
    inFocus: false,
    focusOrder: 0,
    createdAt: 1,
    ...over,
  }
}

function project(id: string, tasks: Array<ReturnType<typeof task>> = []) {
  return {
    id,
    name: id,
    color: 'flame',
    status: 'active',
    collapsed: false,
    showDone: false,
    gridCol: 0,
    gridRow: 0,
    targetDate: null,
    createdAt: 1,
    finishedAt: null,
    shelvedAt: null,
    spaceId: null,
    tasks,
  } as const
}

describe('focusTasks', () => {
  it('returns entries sorted by focusOrder, skipping archived and non-focus tasks', () => {
    const board = [
      project('p1', [
        task('a', 'p1', { inFocus: true, focusOrder: 2048 }),
        task('b', 'p1', { inFocus: false }),
        task('c', 'p1', { inFocus: true, focusOrder: 1024, done: true }),
      ]),
      project('p2', [
        task('d', 'p2', { inFocus: true, focusOrder: 3072, archived: true }),
      ]),
    ] as unknown as BoardData

    const entries = focusTasks(board)
    // done-but-focused stays (the panel splits it into Clear-done), archived drops
    expect(entries.map((e) => e.task.id)).toEqual(['c', 'a'])
  })

  it('hands out the board-owned task and project objects, not copies', () => {
    const board = [
      project('p1', [task('a', 'p1', { inFocus: true, focusOrder: 1024 })]),
    ] as unknown as BoardData

    const [entry] = focusTasks(board)
    // Identity is the perf contract: compiled row components bail out when
    // `task` is the same reference across board patches. A spread (`{...t}`)
    // would hand every row a new object on every call and defeat the cache.
    expect(entry.task).toBe(board[0].tasks[0])
    expect(entry.project).toBe(board[0])
  })
})

describe('focusDrop', () => {
  it('inserts before/after the hovered focus item', () => {
    const board = [
      project('p1', [
        task('a', 'p1', { inFocus: true, focusOrder: 1024 }),
        task('b', 'p1', { inFocus: true, focusOrder: 2048 }),
      ]),
    ] as unknown as BoardData

    expect(focusDrop(board, 'c', { kind: 'fitem', key: 'b' }, 'before')).toBe(
      1536,
    )
    expect(focusDrop(board, 'a', { kind: 'fitem', key: 'b' }, 'after')).toBe(
      3072,
    )
    expect(focusDrop(board, 'c', { kind: 'focuszone', key: '' })).toBe(3072)
  })
})
