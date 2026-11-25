import { describe, expect, it } from 'vitest'

import {
  allDayId,
  calTaskId,
  colId,
  dayId,
  focusItemId,
  parseDragId,
  projId,
  resolveDrop,
  shiftSeries,
  taskId,
} from './drop'
import { focusTask, project, task } from '../testing/board'

import type { CalendarSlot, DropInput } from './drop'
import type { BoardData } from '../types'

const MONDAY = new Date(2026, 10, 23, 9, 0).getTime()
const NEXT_MONDAY = new Date(2026, 10, 30, 9, 0).getTime()
const NEXT_TUESDAY = new Date(2026, 11, 1).getTime()
const NEXT_TUESDAY_TWO = new Date(2026, 11, 1, 14, 0).getTime()

const slotTime = (slot: CalendarSlot) =>
  slot.kind === 'allday' ? slot.dayStart : slot.dayStart + 14 * 3_600_000

function drop(
  board: BoardData,
  active: string,
  over: string,
  overrides: Partial<DropInput> = {},
) {
  return resolveDrop({
    board,
    showDone: false,
    active,
    over,
    side: 'before',
    dropAt: slotTime,
    ...overrides,
  })
}

describe('parseDragId', () => {
  it('reads a plain calendar drag id', () => {
    expect(parseDragId('cal@task-1')).toEqual({
      kind: 'cal',
      key: 'task-1',
      occurrence: null,
    })
  })

  it('splits the occurrence off a repeating calendar drag id', () => {
    expect(parseDragId(calTaskId('task-1', 1761000000000))).toEqual({
      kind: 'cal',
      key: 'task-1',
      occurrence: 1761000000000,
    })
  })

  it('leaves the other kinds without an occurrence', () => {
    expect(parseDragId(taskId('task-1'))).toEqual({
      kind: 'task',
      key: 'task-1',
      occurrence: null,
    })
  })

  it('reads the focus zone and refuses unknown ids', () => {
    expect(parseDragId('focuszone')?.kind).toBe('focuszone')
    expect(parseDragId('nope@1')).toBeNull()
    expect(parseDragId('plain')).toBeNull()
  })
})

describe('shiftSeries', () => {
  it('moves the anchor by the days the occurrence moved, at the new time', () => {
    expect(shiftSeries(MONDAY, NEXT_MONDAY, NEXT_TUESDAY_TWO)).toBe(
      new Date(2026, 10, 24, 14, 0).getTime(),
    )
  })
})

describe('resolveDrop onto the calendar', () => {
  it('shifts the whole series when one occurrence of a repeating task moves', () => {
    const board = [
      project('p1', [task('r', { dueAt: MONDAY, repeat: 'weekly' })]),
    ]
    expect(
      drop(board, calTaskId('r', NEXT_MONDAY), dayId(NEXT_TUESDAY)),
    ).toEqual({
      kind: 'reschedule',
      id: 'r',
      dueAt: new Date(2026, 10, 24, 14, 0).getTime(),
    })
  })

  it('moves a one-off task to the slot under the pointer', () => {
    const board = [project('p1', [task('t', { dueAt: MONDAY })])]
    expect(drop(board, calTaskId('t'), allDayId(NEXT_TUESDAY))).toEqual({
      kind: 'reschedule',
      id: 't',
      dueAt: NEXT_TUESDAY,
    })
  })

  it('schedules a board task dropped on a day', () => {
    const board = [project('p1', [task('t')])]
    expect(drop(board, taskId('t'), dayId(NEXT_TUESDAY))).toEqual({
      kind: 'reschedule',
      id: 't',
      dueAt: NEXT_TUESDAY_TWO,
    })
  })

  it('does nothing when the time does not change', () => {
    const board = [project('p1', [task('t', { dueAt: NEXT_TUESDAY })])]
    expect(drop(board, calTaskId('t'), allDayId(NEXT_TUESDAY))).toBeNull()
  })

  it('refuses a project dropped on a day', () => {
    const board = [project('p1', [])]
    expect(drop(board, projId('p1'), dayId(NEXT_TUESDAY))).toBeNull()
  })
})

describe('resolveDrop on the board', () => {
  const rows = () => [
    project('p1', [
      task('a', { position: 1024 }),
      task('b', { position: 2048 }),
      task('c', { position: 3072 }),
    ]),
    project('p2', [], { gridCol: 1 }),
  ]

  it('puts a task after the row it moved down onto', () => {
    expect(drop(rows(), taskId('a'), taskId('b'))).toEqual({
      kind: 'moveTask',
      id: 'a',
      projectId: 'p1',
      position: 2560,
    })
  })

  it('puts a task before the row it moved up onto', () => {
    expect(drop(rows(), taskId('c'), taskId('a'))).toEqual({
      kind: 'moveTask',
      id: 'c',
      projectId: 'p1',
      position: 0,
    })
  })

  it('appends a task dropped on another project card', () => {
    expect(drop(rows(), taskId('a'), projId('p2'))).toEqual({
      kind: 'moveTask',
      id: 'a',
      projectId: 'p2',
      position: 1024,
    })
  })

  it('moves a project to the end of an empty column', () => {
    expect(drop(rows(), projId('p1'), colId(3))).toEqual({
      kind: 'moveProject',
      id: 'p1',
      gridCol: 3,
      gridRow: 1024,
    })
  })

  it('adds a task to focus when it lands on the focus zone', () => {
    const board = [project('p1', [task('a'), focusTask('f', 1024)])]
    expect(drop(board, taskId('a'), 'focuszone')).toEqual({
      kind: 'focus',
      id: 'a',
      focusOrder: 2048,
    })
  })

  it('reorders focus rows by drag direction', () => {
    const board = [
      project('p1', [
        focusTask('x', 1024),
        focusTask('y', 2048),
        focusTask('z', 3072),
      ]),
    ]
    expect(drop(board, focusItemId('x'), focusItemId('y'))).toEqual({
      kind: 'focus',
      id: 'x',
      focusOrder: 2560,
    })
  })

  it('refuses a focus row dropped outside the focus panel', () => {
    const board = [project('p1', [focusTask('x', 1024)])]
    expect(drop(board, focusItemId('x'), projId('p1'))).toBeNull()
  })
})
