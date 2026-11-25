import type { ProjectWithTasks, Task } from '../types'

export function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    projectId: 'p1',
    parentId: null,
    title: id,
    notes: null,
    position: 1,
    done: false,
    doneAt: null,
    archived: false,
    dueAt: null,
    reminderMinutes: null,
    durationMinutes: null,
    repeat: null,
    addToCalendar: false,
    calendarEventId: null,
    calendarSyncIssue: null,
    importedFromEventId: null,
    inFocus: false,
    focusOrder: 0,
    createdAt: 1,
    assigneeId: null,
    spaceId: null,
    ...overrides,
  }
}

export function project(
  id: string,
  tasks: Array<Task>,
  overrides: Partial<ProjectWithTasks> = {},
): ProjectWithTasks {
  return {
    id,
    name: id,
    color: 'moss',
    status: 'active',
    collapsed: false,
    showDone: true,
    gridCol: 0,
    gridRow: 1,
    targetDate: null,
    createdAt: 1,
    finishedAt: null,
    shelvedAt: null,
    spaceId: null,
    ...overrides,
    tasks,
  }
}

export function focusTask(
  id: string,
  focusOrder: number,
  doneAt: number | null = null,
): Task {
  return task(id, {
    inFocus: true,
    focusOrder,
    done: doneAt !== null,
    doneAt,
  })
}
