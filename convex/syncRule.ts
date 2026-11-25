import type { Doc } from './_generated/dataModel'

export const GOOGLE_EVENTS_SCOPE =
  'https://www.googleapis.com/auth/calendar.events'

export const DEFAULT_REMINDER_MINUTES = 15

export const REMINDER_CHOICES = [5, 15, 30, 60] as const

export type SyncRule = { syncEnabled: boolean; autoAdd: boolean }

export type SyncFields = {
  addToCalendar?: boolean
  dueAt: number | null
  done: boolean
  archived: boolean
  spaceId?: string | null
  importedFromEventId?: string | null
  calendarEventId?: string | null
}

const EVENT_ID = /^[a-v0-9]{5,1024}$/

export function syncRule(
  row: Pick<
    Doc<'userSettings'>,
    'calendarSyncEnabled' | 'autoAddToCalendar'
  > | null,
): SyncRule {
  return {
    syncEnabled: row?.calendarSyncEnabled ?? false,
    autoAdd: row?.autoAddToCalendar ?? false,
  }
}

export function derivedEventId(taskId: string): string | null {
  const id = taskId.replace(/-/g, '').toLowerCase()
  return EVENT_ID.test(id) ? id : null
}

export function taskWantsEvent(task: SyncFields, rule: SyncRule): boolean {
  return (
    rule.syncEnabled &&
    !task.spaceId &&
    (task.importedFromEventId ?? null) === null &&
    (task.addToCalendar === true || rule.autoAdd) &&
    task.dueAt !== null &&
    !task.done &&
    !task.archived
  )
}

export function taskHasEvent(task: SyncFields): boolean {
  return (task.calendarEventId ?? null) !== null
}

export function eventsToDelete(
  tasks: Array<SyncFields & { id: string }>,
): Array<{ taskId: string; eventId: string }> {
  const byEventId = new Map<string, { taskId: string; eventId: string }>()
  for (const task of tasks) {
    if (task.spaceId) continue
    const stored = task.calendarEventId ?? null
    if (stored) byEventId.set(stored, { taskId: task.id, eventId: stored })
    if (task.addToCalendar !== true || task.dueAt === null) continue
    const derived = derivedEventId(task.id)
    if (derived && !byEventId.has(derived))
      byEventId.set(derived, { taskId: task.id, eventId: derived })
  }
  return [...byEventId.values()]
}
