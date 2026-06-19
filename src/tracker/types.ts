import type { InferSelectModel } from 'drizzle-orm'
import type { projects, tasks } from './schema'

export type Project = InferSelectModel<typeof projects>
export type Task = InferSelectModel<typeof tasks>
export type ProjectStatus = Project['status']

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
 *  before the server confirms). The DB accepts the same uuid. */
export function newId(): string {
  return globalThis.crypto.randomUUID()
}

/** Gap used for fractional ordering; new items land at max + GAP. */
export const POSITION_GAP = 1024

export function positionAfter(items: Array<{ position: number }>): number {
  if (items.length === 0) return POSITION_GAP
  return Math.max(...items.map((i) => i.position)) + POSITION_GAP
}

/** Midpoint position for inserting at `index` into an ordered list. */
export function positionAt(
  ordered: Array<number>,
  index: number,
): number {
  if (ordered.length === 0) return POSITION_GAP
  if (index <= 0) return ordered[0] - POSITION_GAP
  if (index >= ordered.length) return ordered[ordered.length - 1] + POSITION_GAP
  return (ordered[index - 1] + ordered[index]) / 2
}
