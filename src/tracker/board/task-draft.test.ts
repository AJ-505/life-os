import { describe, expect, it } from 'vitest'

import { draftView, draftWrites } from './task-draft'
import { task } from '../testing/board'

const DUE = new Date(2026, 10, 24, 9).getTime()

const base = task('t', { title: 'Plan trip', notes: 'Book trains', dueAt: DUE })
const subtasks = [
  { id: 's1', title: 'Hotel' },
  { id: 's2', title: 'Train' },
]

describe('draftView', () => {
  it('shows the saved task when nothing is edited', () => {
    expect(draftView(base, {})).toMatchObject({
      title: 'Plan trip',
      notes: 'Book trains',
      dueAt: DUE,
      newSubtask: '',
    })
  })

  it('shows a cleared date as cleared, not as the saved one', () => {
    expect(draftView(base, { dueAt: null }).dueAt).toBeNull()
  })
})

describe('draftWrites', () => {
  it('writes nothing for an empty draft', () => {
    expect(draftWrites(base, {}, subtasks)).toEqual({
      update: null,
      subtaskTitles: [],
      newSubtask: null,
    })
  })

  it('writes nothing when edits match the saved task', () => {
    const writes = draftWrites(
      base,
      { title: ' Plan trip ', notes: 'Book trains', dueAt: DUE },
      subtasks,
    )
    expect(writes.update).toBeNull()
  })

  it('writes only the fields that changed', () => {
    const writes = draftWrites(
      base,
      { title: 'Plan the trip', dueAt: null, durationMinutes: 45 },
      subtasks,
    )
    expect(writes.update).toEqual({
      title: 'Plan the trip',
      dueAt: null,
      durationMinutes: 45,
    })
  })

  it('ignores a blank title and stores blank notes as none', () => {
    const writes = draftWrites(base, { title: '   ', notes: '  ' }, subtasks)
    expect(writes.update).toEqual({ notes: null })
  })

  it('writes only renamed subtasks and a trimmed new subtask', () => {
    const writes = draftWrites(
      base,
      {
        subtaskTitles: { s1: 'Hotel', s2: ' Night train ' },
        newSubtask: '  Pack  ',
      },
      subtasks,
    )
    expect(writes.subtaskTitles).toEqual([{ id: 's2', title: 'Night train' }])
    expect(writes.newSubtask).toBe('Pack')
  })
})
