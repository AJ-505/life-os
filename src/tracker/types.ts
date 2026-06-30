/**
 * The tracker domain types. These intentionally mirror the shape returned by
 * the Convex `getBoard` query (see `convex/tracker.ts`): string `id`s as the
 * app-facing identity and timestamps as epoch-ms numbers (Convex stores
 * numbers, and that's the one shape both the UI and optimistic updates share).
 */
export interface Project {
  id: string
  name: string
  color: string
  status: ProjectStatus
  collapsed: boolean
  gridCol: number
  gridRow: number
  targetDate: number | null
  createdAt: number
  finishedAt: number | null
  shelvedAt: number | null
}

export interface Task {
  id: string
  projectId: string
  parentId: string | null
  title: string
  notes: string | null
  position: number
  done: boolean
  doneAt: number | null
  archived: boolean
  dueAt: number | null
  inFocus: boolean
  focusOrder: number
  createdAt: number
}

export type ProjectStatus = 'active' | 'shelved' | 'done'

export type ProjectWithTasks = Project & { tasks: Array<Task> }
export type TaskWithProject = Task & { project: Project }

export type BoardData = Array<ProjectWithTasks>

export const PROJECT_COLORS = [
  'flame',
  'saffron',
  'moss',
  'sea',
  'sky',
  'iris',
  'orchid',
  'rose',
  'clay',
  'slate',
] as const

export type ProjectColor = (typeof PROJECT_COLORS)[number]

/** Client-generated id so creates can be optimistic (the row exists locally
 *  before the server confirms). Convex stores the same uuid string. */
export function newId(): string {
  return globalThis.crypto.randomUUID()
}

/** Gap used for fractional ordering; new items land at max + GAP. */
export const POSITION_GAP = 1024

export function positionAfter(items: Array<{ position: number }>): number {
  if (items.length === 0) return POSITION_GAP
  return Math.max(...items.map((i) => i.position)) + POSITION_GAP
}

/**
 * Midpoint position for inserting at `index` into an ordered list.
 *
 * NOTE — precision drift: inserting repeatedly into the *same* gap keeps
 * halving the distance between two neighbours ((a + b) / 2), so after ~50
 * insertions in one spot the two positions converge to the same float and
 * order becomes ambiguous. It's not a concern in normal use (gaps start at
 * POSITION_GAP = 1024 and inserts spread out), but if two items ever end up
 * with near-equal positions, that's the cause. The fix is to occasionally
 * renormalise a column/list back to clean POSITION_GAP multiples
 * (1024, 2048, 3072…) rather than to widen this function.
 */
export function positionAt(ordered: Array<number>, index: number): number {
  if (ordered.length === 0) return POSITION_GAP
  if (index <= 0) return ordered[0] - POSITION_GAP
  if (index >= ordered.length) return ordered[ordered.length - 1] + POSITION_GAP
  return (ordered[index - 1] + ordered[index]) / 2
}
