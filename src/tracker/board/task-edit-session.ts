import { useState } from 'react'

import { appendChildPosition } from './placement'
import { draftView, draftWrites } from './task-draft'
import { useAddTask, useUpdateTask } from '../queries'
import { newId } from '../types'

import type { TaskDraft } from './task-draft'
import type { TaskUpdate } from '../../../convex/taskModel'
import type { BoardData, Task } from '../types'

export function useTaskEditSession(task: Task, board: BoardData) {
  const [draft, setDraft] = useState<TaskDraft>({})
  const updateTask = useUpdateTask()
  const addTask = useAddTask()

  const subtasks = (board.find((p) => p.id === task.projectId)?.tasks ?? [])
    .filter((t) => t.parentId === task.id && !t.archived)
    .sort((a, b) => a.position - b.position)

  const addSubtask = (title: string) => {
    const trimmed = title.trim()
    if (!trimmed) return
    addTask({
      id: newId(),
      projectId: task.projectId,
      parentId: task.id,
      title: trimmed,
      position: appendChildPosition(board, task.id),
    })
  }

  const commit = (extra: TaskUpdate = {}) => {
    const writes = draftWrites(task, draft, subtasks)
    const update = { ...writes.update, ...extra }
    if (Object.keys(update).length > 0)
      updateTask.mutate({ id: task.id, ...update })
    for (const subtask of writes.subtaskTitles)
      updateTask.mutate({ id: subtask.id, title: subtask.title })
    if (writes.newSubtask) addSubtask(writes.newSubtask)
    setDraft({})
  }

  return {
    view: draftView(task, draft),
    subtasks,
    subtaskTitle: (subtask: Task) =>
      draft.subtaskTitles?.[subtask.id] ?? subtask.title,
    edit: (patch: Omit<TaskDraft, 'subtaskTitles'>) =>
      setDraft((current) => ({ ...current, ...patch })),
    editSubtask: (id: string, title: string) =>
      setDraft((current) => ({
        ...current,
        subtaskTitles: { ...current.subtaskTitles, [id]: title },
      })),
    addSubtask: () => {
      addSubtask(draft.newSubtask ?? '')
      setDraft((current) => ({ ...current, newSubtask: '' }))
    },
    commit,
  }
}
