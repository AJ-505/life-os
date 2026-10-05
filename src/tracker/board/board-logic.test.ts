import { describe, expect, it } from 'vitest'

import { descendantIds, focusDrop, focusTasks } from './board-logic'

import type { ProjectWithTasks, Task } from '../types'

/**
 * Client subtree walk, from the 2026-10-03 audit.
 *
 * The server's walks carry a `seen` set because a restored backup can carry a
 * parent cycle. `descendantIds` did not, so a cycle recursed until the stack
 * blew. The cycle case below states the value it wants rather than "does not
 * throw", because an unbounded walk that threw nothing would also pass that.
 */

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
    // a is b's child and b is a's child: unreachable through the mutations,
    // but reachable through a hand-edited or round-tripped backup import.
    // Skipping a candidate already seen, rather than bailing when the walk
    // comes back around, is what keeps `b` in the answer for `a`.
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
    // newest-first, regardless of the order they were added to focus
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
    // ticking the top one done: it must clear the open group entirely
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
    // only `done` flipped: focusOrder never moved, so un-docking is lossless
    const marked = [
      project('p1', [focusTask('a', 1024, 500), focusTask('b', 2048)]),
    ]
    expect(ids(marked)).toEqual(['b', 'a'])
  })

  it('sinks a finished row with no stamp below stamped ones', () => {
    // a restored backup can mark a task done without a stamp
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
    // `c` is finished, so its place in the list comes from when it was finished
    // rather than its stored order. The drop must leave that order alone
    // instead of honouring the pointer.
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
