import { describe, expect, it } from 'vitest'

import {
  boardColumns,
  canvasProjects,
  columnProjects,
  focusTasks,
  withTasksIn,
} from './board-logic'
import { focusTask, project, task } from '../testing/board'
import { NO_PROJECT_ID } from '../types'

import type { ProjectWithTasks } from '../types'

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

describe('the no-project bucket', () => {
  const at = (id: string, position: number) => task(id, { position })
  const bucket = { ...project(NO_PROJECT_ID, []), gridCol: -1 }

  it('stays off the board canvas while real projects remain', () => {
    const board = [project('p1', []), bucket]
    expect(canvasProjects(board).map((p) => p.id)).toEqual(['p1'])
    expect(boardColumns(board)).toEqual([0])
    expect(columnProjects(board, -1)).toEqual([])
  })

  it('appends a bucket when the first loose task arrives', () => {
    const board = [project('p1', [])]
    const next = withTasksIn(board, NO_PROJECT_ID, null, [
      at('b', 2048),
      at('a', 1024),
    ])
    expect(next.map((p) => p.id)).toEqual(['p1', NO_PROJECT_ID])
    expect(next[0]).toBe(board[0])
    expect(next[1].tasks.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('adds to an existing bucket or project in position order', () => {
    const board = [project('p1', [at('x', 2048)]), { ...bucket, tasks: [] }]
    const intoProject = withTasksIn(board, 'p1', null, [at('w', 1024)])
    expect(intoProject[0].tasks.map((t) => t.id)).toEqual(['w', 'x'])
    expect(intoProject).toHaveLength(2)
    const intoBucket = withTasksIn(board, NO_PROJECT_ID, null, [at('l', 1)])
    expect(intoBucket[1].tasks.map((t) => t.id)).toEqual(['l'])
    expect(intoBucket).toHaveLength(2)
  })

  it('drops tasks aimed at a project the board does not have', () => {
    const board = [project('p1', [])]
    expect(withTasksIn(board, 'gone', null, [at('a', 1)])).toEqual(board)
  })
})
