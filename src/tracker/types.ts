import type { Project, Task } from '../../convex/taskModel'

export type {
  Project,
  ProjectStatus,
  SyncIssue,
  Task,
} from '../../convex/taskModel'

export { NO_PROJECT_ID } from '../../convex/taskModel'

export type ProjectWithTasks = Project & { tasks: Array<Task> }

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

export function newId(): string {
  return globalThis.crypto.randomUUID()
}
