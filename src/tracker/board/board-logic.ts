import { noProjectBucket } from '../../../convex/taskModel'
import { NO_PROJECT_ID } from '../types'

import type { BoardData, ProjectWithTasks, Task } from '../types'

export function activeProjects(board: BoardData): Array<ProjectWithTasks> {
  return board.filter((p) => p.status === 'active')
}

export function canvasProjects(board: BoardData): Array<ProjectWithTasks> {
  return activeProjects(board).filter((p) => p.id !== NO_PROJECT_ID)
}

export function withTasksIn(
  board: BoardData,
  projectId: string,
  spaceId: string | null,
  tasks: Array<Task>,
): BoardData {
  const byPosition = (a: Task, b: Task) => a.position - b.position
  if (projectId === NO_PROJECT_ID && !board.some((p) => p.id === projectId))
    return [...board, noProjectBucket(spaceId, [...tasks].sort(byPosition))]
  return board.map((p) =>
    p.id === projectId
      ? { ...p, tasks: [...p.tasks, ...tasks].sort(byPosition) }
      : p,
  )
}

export function columnProjects(
  board: BoardData,
  col: number,
): Array<ProjectWithTasks> {
  return canvasProjects(board)
    .filter((p) => p.gridCol === col)
    .sort((a, b) => a.gridRow - b.gridRow)
}

export function boardColumns(board: BoardData): Array<number> {
  return [...new Set(canvasProjects(board).map((p) => p.gridCol))].sort(
    (a, b) => a - b,
  )
}

export function buildTaskIndex(board: BoardData) {
  const m = new Map<string, { task: Task; project: ProjectWithTasks }>()
  for (const p of board) {
    for (const t of p.tasks) m.set(t.id, { task: t, project: p })
  }
  return m
}

export function projectCounts(project: ProjectWithTasks) {
  const totalCount = project.tasks.filter((t) => !t.archived).length
  const doneCount = project.tasks.filter((t) => t.done && !t.archived).length
  return {
    doneCount,
    totalCount,
    progress: totalCount === 0 ? 0 : doneCount / totalCount,
  }
}

export type TaskNode = { task: Task; children: Array<TaskNode> }

export function taskTree(
  project: ProjectWithTasks,
  showDone: boolean,
): Array<TaskNode> {
  const byParent = new Map<string | null, Array<Task>>()
  for (const t of project.tasks) {
    const key = t.parentId ?? null
    const list = byParent.get(key)
    if (list) list.push(t)
    else byParent.set(key, [t])
  }
  const vis = (t: Task) => !t.archived && (showDone || !t.done)
  const build = (parent: string | null): Array<TaskNode> =>
    (byParent.get(parent) ?? [])
      .map((t) => ({ task: t, children: build(t.id) }))
      .filter((n) => vis(n.task) || n.children.length > 0)
  return build(null)
}

export function visibleTasks(
  project: ProjectWithTasks,
  showDone: boolean,
): Array<Task> {
  return taskTree(project, showDone).map((n) => n.task)
}

export type FocusEntry = { task: Task; project: ProjectWithTasks }

export function focusTasks(board: BoardData): Array<FocusEntry> {
  const out: Array<FocusEntry> = []
  for (const p of activeProjects(board)) {
    for (const t of p.tasks) {
      if (t.inFocus && !t.archived) out.push({ task: t, project: p })
    }
  }
  out.sort(
    (a, b) =>
      Number(a.task.done) - Number(b.task.done) || compareFocus(a.task, b.task),
  )
  return out
}

function compareFocus(a: Task, b: Task): number {
  if (a.done && b.done) return (b.doneAt ?? 0) - (a.doneAt ?? 0)
  return a.focusOrder - b.focusOrder
}
