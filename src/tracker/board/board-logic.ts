import { NO_PROJECT_ID, POSITION_GAP, positionAt } from '../types'

import type { BoardData, ProjectWithTasks, Task } from '../types'

export const projId = (id: string) => `proj@${id}`
export const taskId = (id: string) => `task@${id}`
export const focusItemId = (id: string) => `fitem@${id}`
export const colId = (n: number) => `col@${n}`
export const listId = (projectId: string) => `list@${projectId}`

const DRAG_KINDS = [
  'proj',
  'task',
  'fitem',
  'cal',
  'col',
  'list',
  'day',
  'allday',
] as const

type DragIdKind = (typeof DRAG_KINDS)[number]

const isDragKind = (kind: string): kind is DragIdKind =>
  DRAG_KINDS.some((k) => k === kind)

export function parseDragId(raw: string | number): {
  kind: DragIdKind | 'focuszone'
  key: string
} | null {
  const s = String(raw)
  if (s === 'focuszone') return { kind: 'focuszone', key: '' }
  const at = s.indexOf('@')
  if (at === -1) return null
  const kind = s.slice(0, at)
  if (!isDragKind(kind)) return null
  return { kind, key: s.slice(at + 1) }
}

export function activeProjects(board: BoardData): Array<ProjectWithTasks> {
  return board.filter((p) => p.status === 'active')
}

export function canvasProjects(board: BoardData): Array<ProjectWithTasks> {
  return activeProjects(board).filter((p) => p.id !== NO_PROJECT_ID)
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

export function descendantIds(tasks: Array<Task>, id: string): Array<string> {
  const out: Array<string> = []
  const seen = new Set([id])
  const walk = (parent: string) => {
    for (const t of tasks) {
      if (t.parentId === parent && !seen.has(t.id)) {
        seen.add(t.id)
        out.push(t.id)
        walk(t.id)
      }
    }
  }
  walk(id)
  return out
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

export function projectDrop(
  board: BoardData,
  activeProjectId: string,
  over: { kind: 'proj' | 'col'; key: string },
  side: 'before' | 'after' = 'before',
): { gridCol: number; gridRow: number } | null {
  if (over.kind === 'col') {
    const col = Number(over.key)
    const rows = columnProjects(board, col).filter(
      (p) => p.id !== activeProjectId,
    )
    const last = rows.at(-1)
    return {
      gridCol: col,
      gridRow: last ? last.gridRow + POSITION_GAP : POSITION_GAP,
    }
  }
  if (over.key === activeProjectId) return null
  const overProject = board.find((p) => p.id === over.key)
  if (!overProject) return null
  const col = overProject.gridCol
  const rows = columnProjects(board, col).filter(
    (p) => p.id !== activeProjectId,
  )
  const base = rows.findIndex((p) => p.id === over.key)
  const index = base === -1 ? rows.length : base + (side === 'after' ? 1 : 0)
  return {
    gridCol: col,
    gridRow: positionAt(
      rows.map((p) => p.gridRow),
      index,
    ),
  }
}

export function taskDrop(
  board: BoardData,
  activeTaskId: string,
  over: { kind: 'task' | 'list'; key: string },
  showDone: boolean,
  side: 'before' | 'after' = 'before',
): { projectId: string; position: number } | null {
  if (over.kind === 'list') {
    const project = board.find((p) => p.id === over.key)
    if (!project) return null
    const items = visibleTasks(project, showDone || project.showDone).filter(
      (t) => t.id !== activeTaskId,
    )
    const last = items.at(-1)
    return {
      projectId: project.id,
      position: last ? last.position + POSITION_GAP : POSITION_GAP,
    }
  }
  if (over.key === activeTaskId) return null
  const project = board.find((p) => p.tasks.some((t) => t.id === over.key))
  if (!project) return null
  const items = visibleTasks(project, showDone || project.showDone).filter(
    (t) => t.id !== activeTaskId,
  )
  const base = items.findIndex((t) => t.id === over.key)
  const index = base === -1 ? items.length : base + (side === 'after' ? 1 : 0)
  return {
    projectId: project.id,
    position: positionAt(
      items.map((t) => t.position),
      index,
    ),
  }
}

export function focusDrop(
  board: BoardData,
  activeTaskId: string,
  over: { kind: 'fitem' | 'focuszone'; key: string },
  side: 'before' | 'after' = 'before',
): number {
  const all = focusTasks(board)
  const dragged = all.find((e) => e.task.id === activeTaskId)
  if (dragged?.task.done) return dragged.task.focusOrder

  const items = all.filter((e) => !e.task.done && e.task.id !== activeTaskId)
  const last = items.at(-1)
  if (
    over.kind === 'focuszone' ||
    over.key === activeTaskId ||
    items.length === 0
  ) {
    return last ? last.task.focusOrder + POSITION_GAP : POSITION_GAP
  }
  const base = items.findIndex((e) => e.task.id === over.key)
  const index = base === -1 ? items.length : base + (side === 'after' ? 1 : 0)
  return positionAt(
    items.map((e) => e.task.focusOrder),
    index,
  )
}
