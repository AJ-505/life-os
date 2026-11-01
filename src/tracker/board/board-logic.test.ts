import { describe, expect, it } from 'vitest'

import { NO_PROJECT_ID } from '../types'
import {
  boardColumns,
  canvasProjects,
  columnProjects,
  descendantIds,
  focusDrop,
  focusTasks,
} from './board-logic'

import type { ProjectWithTasks, Task } from '../types'

function task(id: string, parentId: string | null): Task {
  return {
    id,
    projectId: 'p1',
    parentId,
    title: id,
    notes: null,
    position: 1,
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
    assigneeId: null,
    spaceId: null,
  }
}

describe('descendantIds', () => {
  it('walks a normal tree', () => {
    const tasks = [
      task('root', null),
      task('child', 'root'),
      task('grandchild', 'child'),
      task('other', null),
    ]
    expect(descendantIds(tasks, 'root').sort()).toEqual(['child', 'grandchild'])
  })

  it('terminates on a parent cycle, and still returns the other half', () => {
    const cyclic = [task('a', 'b'), task('b', 'a')]
    expect(descendantIds(cyclic, 'a')).toEqual(['b'])
    expect(descendantIds(cyclic, 'b')).toEqual(['a'])
  })

  it('stops a cycle from swallowing a real subtask', () => {
    const cyclic = [task('a', 'b'), task('b', 'a'), task('real', 'b')]
    expect(descendantIds(cyclic, 'a').sort()).toEqual(['b', 'real'])
  })
})

function project(id: string, tasks: Array<Task>): ProjectWithTasks {
  return {
    id,
    name: id,
    color: 'moss',
    status: 'active',
    collapsed: false,
    showDone: true,
    gridCol: 0,
    gridRow: 1,
    targetDate: null,
    createdAt: 1,
    finishedAt: null,
    shelvedAt: null,
    spaceId: null,
    tasks,
  }
}

function focusTask(
  id: string,
  focusOrder: number,
  doneAt: number | null = null,
): Task {
  return {
    ...task(id, null),
    inFocus: true,
    focusOrder,
    done: doneAt !== null,
    doneAt,
  }
}

const ids = (board: Array<ProjectWithTasks>) =>
  focusTasks(board).map((e) => e.task.id)

describe('focusTasks', () => {
  it('sinks finished rows below open ones', () => {
    const board = [
      project('p1', [
        focusTask('a', 1024),
        focusTask('b', 2048, 5),
        focusTask('c', 3072),
        focusTask('d', 4096, 9),
      ]),
    ]
    expect(ids(board)).toEqual(['a', 'c', 'd', 'b'])
  })

  it('puts the newest finished row at the top of the finished pile', () => {
    const board = [
      project('p1', [
        focusTask('oldest', 1024, 100),
        focusTask('newest', 2048, 300),
        focusTask('middle', 3072, 200),
      ]),
    ]
    expect(ids(board)).toEqual(['newest', 'middle', 'oldest'])
  })

  it('sinks a just-finished row below every open row', () => {
    const board = [
      project('p1', [
        focusTask('first', 1024),
        focusTask('second', 2048),
        focusTask('third', 3072),
      ]),
    ]
    expect(ids(board)).toEqual(['first', 'second', 'third'])
    const marked = [
      project('p1', [
        focusTask('first', 1024, 500),
        focusTask('second', 2048),
        focusTask('third', 3072),
      ]),
    ]
    expect(ids(marked)).toEqual(['second', 'third', 'first'])
  })

  it('returns a row to its own slot when it is un-done', () => {
    const open = [project('p1', [focusTask('a', 1024), focusTask('b', 2048)])]
    expect(ids(open)).toEqual(['a', 'b'])
    const marked = [
      project('p1', [focusTask('a', 1024, 500), focusTask('b', 2048)]),
    ]
    expect(ids(marked)).toEqual(['b', 'a'])
  })

  it('sinks a finished row with no stamp below stamped ones', () => {
    const board = [
      project('p1', [
        { ...focusTask('stamped', 1024, 100), done: true, doneAt: null },
        focusTask('recent', 2048, 100),
      ]),
    ]
    expect(ids(board)).toEqual(['recent', 'stamped'])
  })
})

describe('focusDrop', () => {
  it('keeps a finished row where it is when it is dragged', () => {
    const board = [
      project('p1', [
        focusTask('a', 3072),
        focusTask('b', 4096),
        focusTask('c', 1024, 100),
      ]),
    ]
    expect(focusDrop(board, 'c', { kind: 'fitem', key: 'a' }, 'before')).toBe(
      1024,
    )
  })

  it('positions open rows against other open rows, ignoring finished ones', () => {
    const board = [
      project('p1', [
        focusTask('a', 1024),
        focusTask('done', 2048, 100),
        focusTask('b', 4096),
      ]),
    ]
    expect(focusDrop(board, 'b', { kind: 'fitem', key: 'a' }, 'before')).toBe(0)
  })

  it('still reorders open rows by the drop position', () => {
    const board = [
      project('p1', [
        focusTask('a', 1024),
        focusTask('b', 2048),
        focusTask('c', 3072),
      ]),
    ]
    expect(focusDrop(board, 'c', { kind: 'fitem', key: 'a' }, 'before')).toBe(0)
  })
})

describe('the no-project bucket on the board canvas', () => {
  const bucket = project(NO_PROJECT_ID, [])
  const board = [project('p1', []), { ...bucket, gridCol: -1 }]

  it('hides the bucket from the board canvas but keeps real projects', () => {
    expect(canvasProjects(board).map((p) => p.id)).toEqual(['p1'])
    expect(boardColumns(board)).toEqual([0])
    expect(columnProjects(board, 0).map((p) => p.id)).toEqual(['p1'])
    expect(columnProjects(board, -1)).toEqual([])
  })
})
