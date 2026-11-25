import type { RepeatRule } from '../../../convex/recurrence'
import type { TaskUpdate } from '../../../convex/taskModel'
import type { Task } from '../types'

export type TaskDraft = {
  title?: string
  notes?: string
  dueAt?: number | null
  reminderMinutes?: number | null
  durationMinutes?: number | null
  addToCalendar?: boolean
  repeat?: RepeatRule | null
  subtaskTitles?: Record<string, string>
  newSubtask?: string
}

export type DraftView = {
  title: string
  notes: string
  dueAt: number | null
  reminderMinutes: number | null
  durationMinutes: number | null
  addToCalendar: boolean
  repeat: RepeatRule | null
  newSubtask: string
}

export type DraftWrites = {
  update: TaskUpdate | null
  subtaskTitles: Array<{ id: string; title: string }>
  newSubtask: string | null
}

export function draftView(task: Task, draft: TaskDraft): DraftView {
  return {
    title: draft.title ?? task.title,
    notes: draft.notes ?? task.notes ?? '',
    dueAt: draft.dueAt !== undefined ? draft.dueAt : task.dueAt,
    reminderMinutes:
      draft.reminderMinutes !== undefined
        ? draft.reminderMinutes
        : task.reminderMinutes,
    durationMinutes:
      draft.durationMinutes !== undefined
        ? draft.durationMinutes
        : task.durationMinutes,
    addToCalendar: draft.addToCalendar ?? task.addToCalendar,
    repeat: draft.repeat !== undefined ? draft.repeat : task.repeat,
    newSubtask: draft.newSubtask ?? '',
  }
}

const FIELDS = [
  'dueAt',
  'reminderMinutes',
  'durationMinutes',
  'addToCalendar',
  'repeat',
] as const

export function draftWrites(
  task: Task,
  draft: TaskDraft,
  subtasks: Array<Pick<Task, 'id' | 'title'>>,
): DraftWrites {
  const update: TaskUpdate = {}
  const title = draft.title?.trim()
  if (title && title !== task.title) update.title = title
  if (draft.notes !== undefined) {
    const notes = draft.notes.trim() || null
    if (notes !== task.notes) update.notes = notes
  }
  for (const field of FIELDS) {
    const value = draft[field]
    if (value !== undefined && value !== task[field])
      Object.assign(update, { [field]: value })
  }

  const subtaskTitles = subtasks.flatMap((subtask) => {
    const edited = draft.subtaskTitles?.[subtask.id]?.trim()
    return edited && edited !== subtask.title
      ? [{ id: subtask.id, title: edited }]
      : []
  })

  return {
    update: Object.keys(update).length > 0 ? update : null,
    subtaskTitles,
    newSubtask: draft.newSubtask?.trim() || null,
  }
}
