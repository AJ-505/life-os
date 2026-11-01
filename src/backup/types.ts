export interface BackupProject {
  id: string
  name: string
  color: string | null
  status: string | null
  collapsed: boolean | null
  gridCol: number | null
  gridRow: number | null
  targetDate: string | null
  createdAt: string | null
  finishedAt: string | null
  shelvedAt: string | null
}

export interface BackupTask {
  id: string
  projectId: string | null
  parentId?: string | null
  title: string
  notes: string | null
  position: number | null
  done: boolean | null
  doneAt: string | null
  archived: boolean | null
  dueAt: string | null
  inFocus: boolean | null
  focusOrder: number | null
  createdAt: string | null
  reminderMinutes?: number | null
  addToCalendar?: boolean | null
  calendarEventId?: string | null
}

export interface BackupFile {
  app: 'lifeos'
  version: 1
  exportedAt: string
  projects: Array<BackupProject>
  tasks: Array<BackupTask>
}
