import { POSITION_GAP, positionAt } from '../types'

import type { BoardData, ProjectWithTasks, Task } from '../types'

/* Drag ids: `proj@<id>` `task@<id>` `fitem@<id>` — droppables: `col@<n>`,
 * `list@<projectId>`, `focuszone`. */

export const projId = (id: string) => `proj@${id}`
export const taskId = (id: string) => `task@${id}`
export const focusItemId = (id: string) => `fitem@${id}`
export const colId = (n: number) => `col@${n}`
export const listId = (projectId: string) => `list@${projectId}`

export function parseDragId(raw: string | number): {
  kind: 'proj' | 'task' | 'fitem' | 'col' | 'list' | 'focuszone'
  key: string
} | null {
  const s = String(raw)
  if (s === 'focuszone') return { kind: 'focuszone', key: '' }
  const at = s.indexOf('@')
  if (at === -1) return null
  const kind = s.slice(0, at)
  if (!['proj', 'task', 'fitem', 'col', 'list'].includes(kind)) return null
  return { kind: kind as 'proj' | 'task' | 'fitem' | 'col' | 'list', key: s.slice(at + 1) }
}

export function activeProjects(board: BoardData): Array<ProjectWithTasks> {
  return board.filter((p) => p.status === 'active')
}

export function columnProjects(
  board: BoardData,
  col: number,
): Array<ProjectWithTasks> {
  return activeProjects(board)
    .filter((p) => p.gridCol === col)
    .sort((a, b) => a.gridRow - b.gridRow)
}

export function columnCount(board: BoardData): number {
  const active = activeProjects(board)
  if (active.length === 0) return 1
  return Math.max(...active.map((p) => p.gridCol)) + 1
}

export function visibleTasks(
  project: ProjectWithTasks,
  showDone: boolean,
): Array<Task> {
  return project.tasks.filter((t) => !t.archived && (showDone || !t.done))
}

export function focusTasks(board: BoardData): Array<Task & { project: ProjectWithTasks }> {
  return activeProjects(board)
    .flatMap((p) => p.tasks.map((t) => ({ ...t, project: p })))
    .filter((t) => t.inFocus && !t.archived)
    .sort((a, b) => a.focusOrder - b.focusOrder)
}

/**
 * Where should a dragged project land?
 * `overIndex` is dnd-kit's sortable index of the item being hovered
 * (arrayMove semantics: remove active, insert at overIndex).
 */
export function projectDrop(
  board: BoardData,
  activeProjectId: string,
  over: { kind: 'proj' | 'col'; key: string; overIndex: number },
): { gridCol: number; gridRow: number } | null {
  if (over.kind === 'col') {
    const col = Number(over.key)
    const rows = columnProjects(board, col).filter(
      (p) => p.id !== activeProjectId,
    )
    const last = rows.at(-1)
    return { gridCol: col, gridRow: last ? last.gridRow + POSITION_GAP : POSITION_GAP }
  }
  const overProject = board.find((p) => p.id === over.key)
  if (!overProject || overProject.id === activeProjectId) return null
  const col = overProject.gridCol
  const rows = columnProjects(board, col).filter(
    (p) => p.id !== activeProjectId,
  )
  const index = Math.max(0, Math.min(over.overIndex, rows.length))
  return {
    gridCol: col,
    gridRow: positionAt(rows.map((p) => p.gridRow), index),
  }
}

/** Where should a dragged task land inside a project list? */
export function taskDrop(
  board: BoardData,
  activeTaskId: string,
  over: { kind: 'task' | 'list'; key: string; overIndex: number },
  showDone: boolean,
): { projectId: string; position: number } | null {
  if (over.kind === 'list') {
    const project = board.find((p) => p.id === over.key)
    if (!project) return null
    const items = visibleTasks(project, showDone).filter(
      (t) => t.id !== activeTaskId,
    )
    const last = items.at(-1)
    return {
      projectId: project.id,
      position: last ? last.position + POSITION_GAP : POSITION_GAP,
    }
  }
  const project = board.find((p) => p.tasks.some((t) => t.id === over.key))
  if (!project) return null
  const items = visibleTasks(project, showDone).filter(
    (t) => t.id !== activeTaskId,
  )
  const index = Math.max(0, Math.min(over.overIndex, items.length))
  return {
    projectId: project.id,
    position: positionAt(items.map((t) => t.position), index),
  }
}

/** focusOrder for dropping into the focus panel. */
export function focusDrop(
  board: BoardData,
  activeTaskId: string,
  over: { kind: 'fitem' | 'focuszone'; key: string; overIndex: number },
): number {
  const items = focusTasks(board).filter((t) => t.id !== activeTaskId)
  if (over.kind === 'focuszone' || items.length === 0) {
    const last = items.at(-1)
    return last ? last.focusOrder + POSITION_GAP : POSITION_GAP
  }
  const index = Math.max(0, Math.min(over.overIndex, items.length))
  return positionAt(items.map((t) => t.focusOrder), index)
}
