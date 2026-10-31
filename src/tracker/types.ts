export interface Project {
  id: string
  name: string
  color: string
  status: ProjectStatus
  collapsed: boolean
  showDone: boolean
  gridCol: number
  gridRow: number
  targetDate: number | null
  createdAt: number
  finishedAt: number | null
  shelvedAt: number | null
  spaceId: string | null
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
  reminderMinutes: number | null
  addToCalendar: boolean
  calendarEventId: string | null
  inFocus: boolean
  focusOrder: number
  createdAt: number
  assigneeId: string | null
  spaceId: string | null
}

export type ProjectStatus = 'active' | 'shelved' | 'done'

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

export const POSITION_GAP = 1024

export function positionAfter(items: Array<{ position: number }>): number {
  if (items.length === 0) return POSITION_GAP
  return Math.max(...items.map((i) => i.position)) + POSITION_GAP
}

export function positionAt(ordered: Array<number>, index: number): number {
  if (ordered.length === 0) return POSITION_GAP
  if (index <= 0) return ordered[0] - POSITION_GAP
  if (index >= ordered.length) return ordered[ordered.length - 1] + POSITION_GAP
  return (ordered[index - 1] + ordered[index]) / 2
}
