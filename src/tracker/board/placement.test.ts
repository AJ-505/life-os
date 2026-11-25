import { describe, expect, it } from 'vitest'

import {
  appendChildPosition,
  appendFocusOrder,
  appendProjectRow,
  appendRootPosition,
  focusDrop,
  positionAt,
} from './placement'
import { focusTask, project, task } from '../testing/board'

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

describe('append positions', () => {
  it('puts a new root task after the last root, ignoring subtasks', () => {
    const p = project('p1', [
      task('a', { position: 1024 }),
      task('sub', { parentId: 'a', position: 9000 }),
    ])
    expect(appendRootPosition(p)).toBe(2048)
    expect(appendRootPosition(undefined)).toBe(1024)
  })

  it('puts a new subtask after its last sibling', () => {
    const board = [
      project('p1', [
        task('a'),
        task('s1', { parentId: 'a', position: 1024 }),
        task('s2', { parentId: 'a', position: 4096 }),
      ]),
    ]
    expect(appendChildPosition(board, 'a')).toBe(5120)
    expect(appendChildPosition(board, 's1')).toBe(1024)
  })

  it('puts a new project at the bottom of its column', () => {
    const board = [
      project('p1', [], { gridCol: 0, gridRow: 1024 }),
      project('p2', [], { gridCol: 0, gridRow: 3072 }),
      project('p3', [], { gridCol: 1, gridRow: 9000 }),
    ]
    expect(appendProjectRow(board, 0)).toBe(4096)
    expect(appendProjectRow(board, 2)).toBe(1024)
  })

  it('adds a task to the end of the open focus rows', () => {
    const board = [
      project('p1', [
        focusTask('a', 1024),
        focusTask('done', 9000, 5),
        task('new'),
      ]),
    ]
    expect(appendFocusOrder(board, 'new')).toBe(2048)
  })

  it('splits the gap between two neighbours', () => {
    expect(positionAt([1024, 2048], 1)).toBe(1536)
    expect(positionAt([1024, 2048], 0)).toBe(0)
    expect(positionAt([1024, 2048], 2)).toBe(3072)
    expect(positionAt([], 0)).toBe(1024)
  })
})
