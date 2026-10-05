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
  return {
    kind: kind as 'proj' | 'task' | 'fitem' | 'col' | 'list',
    key: s.slice(at + 1),
  }
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

/**
 * Task id -> { task, project }, flattened once per board identity. The host
 * (keybindings) and any other repeated lookup build this once instead of
 * rescanning every project's list per press.
 */
export function buildTaskIndex(board: BoardData) {
  const m = new Map<string, { task: Task; project: ProjectWithTasks }>()
  for (const p of board) {
    for (const t of p.tasks) m.set(t.id, { task: t, project: p })
  }
  return m
}

/**
 * Done / total over a project's visible (non-archived) tasks, the numbers the
 * progress bar and the "x/y" label both show. One definition here — the same
 * arithmetic had drifted into three copies with subtly different filters.
 */
export function projectCounts(project: ProjectWithTasks) {
  const totalCount = project.tasks.filter((t) => !t.archived).length
  const doneCount = project.tasks.filter((t) => t.done && !t.archived).length
  return {
    doneCount,
    totalCount,
    progress: totalCount === 0 ? 0 : doneCount / totalCount,
  }
}

/* ------------------------------------------------------------ task nesting */

export type TaskNode = { task: Task; children: Array<TaskNode> }

/**
 * Visible task tree for a project card. A row stays visible while anything
 * in its subtree is (so finishing a parent never hides open subtasks).
 *
 * `build` needs no cycle guard, unlike `descendantIds`: it walks down from
 * `null`, and a task inside a cycle has a non-null `parentId`, so nothing in
 * a cycle is ever reachable from a root and the walk cannot revisit a node.
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

/**
 * Every descendant task id of `id`, for cascade-style cache updates.
 *
 * The `seen` set carries the requested id too, so a `parentId` cycle - reachable
 * through a restored backup, which validates nothing - terminates instead of
 * blowing the stack inside an optimistic delete. A candidate already seen is
 * skipped rather than pushed, so asking about one half of a two-task cycle still
 * returns the other half.
 */
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

/**
 * In-focus rows, project attached beside the task, not spread onto it.
 * `{ ...t, project }` allocated a new task-shaped object on every call, so
 * compiled FocusItemBody saw a new `task` prop on every board patch and
 * could never skip. `task` here is the board's own object.
 *
 * Finished rows sink below the open ones, and among themselves they read
 * newest-finished first: ticking done puts a row at the top of the finished pile
 * rather than burying it under work finished earlier. Open rows keep focusOrder,
 * so un-ticking returns one to its own slot instead of stranding it down there.
 *
 * `doneAt` is server-derived, but a restored backup can carry a finished row
 * with no stamp. Those fall back to 0, so they sit at the bottom of the finished
 * pile instead of pretending to be the newest thing you did.
 */
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

/** Within one group of the focus list: finished rows newest first, open rows in
 *  the order the user gave them. */
function compareFocus(a: Task, b: Task): number {
  if (a.done && b.done) return (b.doneAt ?? 0) - (a.doneAt ?? 0)
  return a.focusOrder - b.focusOrder
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
 *  hovered item per `side`, or at the end when dropped on the zone itself.
 *
 *  Only open rows are positioned. A finished row's place in the list comes from
 *  when it was finished, not from focusOrder, so moving it would either do
 *  nothing on screen or silently rewrite when you un-tick it. Finished rows
 *  therefore keep their stored order and stay where they land. */
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
