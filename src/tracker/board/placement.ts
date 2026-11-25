import { columnProjects, focusTasks, visibleTasks } from './board-logic'

import type { BoardData, ProjectWithTasks } from '../types'

export const POSITION_GAP = 1024

type Side = 'before' | 'after'

function positionAfter(positions: Array<number>): number {
  if (positions.length === 0) return POSITION_GAP
  return Math.max(...positions) + POSITION_GAP
}

export function positionAt(ordered: Array<number>, index: number): number {
  if (ordered.length === 0) return POSITION_GAP
  if (index <= 0) return ordered[0] - POSITION_GAP
  if (index >= ordered.length) return ordered[ordered.length - 1] + POSITION_GAP
  return (ordered[index - 1] + ordered[index]) / 2
}

export function appendRootPosition(
  project: Pick<ProjectWithTasks, 'tasks'> | undefined,
): number {
  const roots = (project?.tasks ?? []).filter((task) => !task.parentId)
  return positionAfter(roots.map((task) => task.position))
}

export function appendChildPosition(
  board: BoardData,
  parentId: string,
): number {
  const children = board.flatMap((project) =>
    project.tasks.filter((task) => task.parentId === parentId),
  )
  return positionAfter(children.map((task) => task.position))
}

export function appendProjectRow(board: BoardData, col: number): number {
  return positionAfter(columnProjects(board, col).map((p) => p.gridRow))
}

export function appendFocusOrder(board: BoardData, taskId: string): number {
  return focusDrop(board, taskId, { kind: 'focuszone', key: '' })
}

export function projectDrop(
  board: BoardData,
  activeProjectId: string,
  over: { kind: 'proj' | 'col'; key: string },
  side: Side = 'before',
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
  side: Side = 'before',
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
  side: Side = 'before',
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
