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

/**
 * The columns that actually exist, compacted: only gridCol values that hold
 * at least one active project. Emptying a column (delete, move) makes it
 * vanish instead of leaving a stranded "+ Project" placeholder behind.
 */
export function boardColumns(board: BoardData): Array<number> {
  return [...new Set(activeProjects(board).map((p) => p.gridCol))].sort(
    (a, b) => a - b,
  )
}

/* ------------------------------------------------------------ task nesting */

export type TaskNode = { task: Task; children: Array<TaskNode> }

/**
 * Visible task tree for a project card. A row stays visible while anything
 * in its subtree is (so finishing a parent never hides open subtasks).
 */
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

/** Top-level visible tasks — the sortable rows position math runs against. */
export function visibleTasks(
  project: ProjectWithTasks,
  showDone: boolean,
): Array<Task> {
  return taskTree(project, showDone).map((n) => n.task)
}

/** Every descendant task id of `id`, for cascade-style cache updates. */
export function descendantIds(tasks: Array<Task>, id: string): Array<string> {
  const out: Array<string> = []
  const walk = (parent: string) => {
    for (const t of tasks) {
      if (t.parentId === parent) {
        out.push(t.id)
        walk(t.id)
      }
    }
  }
  walk(id)
  return out
}

export function focusTasks(board: BoardData): Array<Task & { project: ProjectWithTasks }> {
  return activeProjects(board)
    .flatMap((p) => p.tasks.map((t) => ({ ...t, project: p })))
    .filter((t) => t.inFocus && !t.archived)
    .sort((a, b) => a.focusOrder - b.focusOrder)
}

/**
 * Where should a dragged project land? We derive the slot from the hovered
 * project's id (not a sortable index, which is off-by-one whenever the dragged
 * item starts ahead of its target). `side` says whether the drop fell on the
 * top half ('before') or bottom half ('after') of the hovered card, so placing
 * something clearly below a project actually lands it below. Dropping on a
 * column appends to that column.
 */
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
    return { gridCol: col, gridRow: last ? last.gridRow + POSITION_GAP : POSITION_GAP }
  }
  if (over.key === activeProjectId) return null
  const overProject = board.find((p) => p.id === over.key)
  if (!overProject) return null
  const col = overProject.gridCol
  const rows = columnProjects(board, col).filter(
    (p) => p.id !== activeProjectId,
  )
  const base = rows.findIndex((p) => p.id === over.key)
  // Dropped-on-bottom-half → insert after the hovered card (index + 1). Since
  // `rows` already excludes the dragged project, this index is collision-free.
  const index = base === -1 ? rows.length : base + (side === 'after' ? 1 : 0)
  return {
    gridCol: col,
    gridRow: positionAt(
      rows.map((p) => p.gridRow),
      index,
    ),
  }
}

/** Where should a dragged task land? Inserts before or after the hovered task
 *  per `side` (which half it was dropped on), or at the end when dropped on the
 *  list/empty area. `showDone` is the board-wide switch; each project's own
 *  `showDone` override is OR-ed in so the math matches what the card renders. */
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

/** focusOrder for dropping into the focus panel; inserts before or after the
 *  hovered item per `side`, or at the end when dropped on the zone itself. */
export function focusDrop(
  board: BoardData,
  activeTaskId: string,
  over: { kind: 'fitem' | 'focuszone'; key: string },
  side: 'before' | 'after' = 'before',
): number {
  const items = focusTasks(board).filter((t) => t.id !== activeTaskId)
  if (over.kind === 'focuszone' || over.key === activeTaskId || items.length === 0) {
    const last = items.at(-1)
    return last ? last.focusOrder + POSITION_GAP : POSITION_GAP
  }
  const base = items.findIndex((t) => t.id === over.key)
  const index = base === -1 ? items.length : base + (side === 'after' ? 1 : 0)
  return positionAt(
    items.map((t) => t.focusOrder),
    index,
  )
}
