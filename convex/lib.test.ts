import { describe, expect, it } from 'vitest'

import { shapeProject, shapeTask } from './lib'

import type { Doc } from './_generated/dataModel'

/**
 * These guard the failure that shipped: `shapeTask` was a hand-written field
 * list that never learned about `reminderMinutes` or `calendarEventId`, so the
 * board query silently dropped them and the calendar toggle read false on
 * every open. The shapers are now written as omissions, and these tests fail
 * if anyone turns them back into enumerations.
 */

const task: Doc<'tasks'> = {
  _id: 'k1' as Doc<'tasks'>['_id'],
  _creationTime: 1,
  userId: 'user_secret',
  id: 't1',
  projectId: 'p1',
  parentId: null,
  title: 'Ship it',
  notes: null,
  position: 1024,
  done: false,
  doneAt: null,
  archived: false,
  dueAt: 1_700_000_000_000,
  reminderMinutes: 30,
  addToCalendar: true,
  calendarEventId: 'gcal_abc',
  inFocus: false,
  focusOrder: 0,
  createdAt: 1,
}

const project: Doc<'projects'> = {
  _id: 'k2' as Doc<'projects'>['_id'],
  _creationTime: 1,
  userId: 'user_secret',
  id: 'p1',
  name: 'Life OS',
  color: 'moss',
  status: 'active',
  collapsed: false,
  gridCol: 0,
  gridRow: 1024,
  targetDate: null,
  createdAt: 1,
  finishedAt: null,
  shelvedAt: null,
}

describe('shapeTask', () => {
  it('keeps every schema field the client is allowed to see', () => {
    const shaped = shapeTask(task)
    const hidden = ['_id', '_creationTime', 'userId']
    const expected = Object.keys(task).filter((k) => !hidden.includes(k))
    expect(Object.keys(shaped).sort()).toEqual(expected.sort())
  })

  it('carries the calendar fields the board used to drop', () => {
    const shaped = shapeTask(task)
    expect(shaped.reminderMinutes).toBe(30)
    expect(shaped.addToCalendar).toBe(true)
    expect(shaped.calendarEventId).toBe('gcal_abc')
  })

  it('never leaks the owning user or Convex internals', () => {
    const shaped: Record<string, unknown> = shapeTask(task)
    expect(shaped.userId).toBeUndefined()
    expect(shaped._id).toBeUndefined()
    expect(shaped._creationTime).toBeUndefined()
  })

  it('normalises absent optionals so the client never sees undefined', () => {
    const { reminderMinutes, addToCalendar, calendarEventId, ...bare } = task
    const shaped = shapeTask(bare)
    expect(shaped.reminderMinutes).toBeNull()
    expect(shaped.addToCalendar).toBe(false)
    expect(shaped.calendarEventId).toBeNull()
  })
})

describe('shapeProject', () => {
  it('never leaks the owning user or Convex internals', () => {
    const shaped: Record<string, unknown> = shapeProject(project)
    expect(shaped.userId).toBeUndefined()
    expect(shaped._id).toBeUndefined()
    expect(shaped._creationTime).toBeUndefined()
  })

  it('normalises absent optionals', () => {
    const shaped = shapeProject(project)
    expect(shaped.showDone).toBe(false)
    expect(shaped.spaceId).toBeNull()
  })

  it('agrees with what the client Project type declares', () => {
    // The board and the space board used to run through two divergent copies
    // of this function; one returned spaceId and the other didn't.
    const shaped = shapeProject({ ...project, spaceId: 's1', showDone: true })
    expect(shaped.spaceId).toBe('s1')
    expect(shaped.showDone).toBe(true)
  })
})
