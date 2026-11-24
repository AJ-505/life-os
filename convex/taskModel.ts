import { v } from 'convex/values'

import { nextOccurrence } from './recurrence'

import type { Infer } from 'convex/values'
import type { Doc } from './_generated/dataModel'
import type { RepeatRule } from './recurrence'

export const NO_PROJECT_ID = '~none'

export const storedProjectId = (id: string) =>
  id === NO_PROJECT_ID ? null : id

export const projectStatus = v.union(
  v.literal('active'),
  v.literal('shelved'),
  v.literal('done'),
)

export type ProjectStatus = Infer<typeof projectStatus>

export const syncIssue = v.union(
  v.literal('not_configured'),
  v.literal('not_connected'),
  v.literal('reauth_required'),
  v.literal('missing_scope'),
  v.literal('no_timezone'),
  v.literal('not_personal'),
  v.literal('event_removed'),
  v.literal('rate_limited'),
  v.literal('google_error'),
)

export type SyncIssue = Infer<typeof syncIssue>

export const SYNC_ISSUES = syncIssue.members.map((member) => member.value)

export const activityKind = v.union(
  v.literal('created'),
  v.literal('assigned'),
  v.literal('unassigned'),
  v.literal('completed'),
  v.literal('reopened'),
  v.literal('archived'),
  v.literal('unarchived'),
  v.literal('moved'),
  v.literal('updated'),
)

export type ActivityKind = Infer<typeof activityKind>

export const MIN_DURATION_MINUTES = 5
export const MAX_DURATION_MINUTES = 24 * 60

export function clampDuration(minutes: number | null | undefined) {
  if (minutes == null || !Number.isFinite(minutes)) return null
  return Math.max(
    MIN_DURATION_MINUTES,
    Math.min(MAX_DURATION_MINUTES, Math.round(minutes)),
  )
}

export function shapeProject(p: Doc<'projects'>) {
  const { _id, _creationTime, userId: _userId, ...rest } = p
  return {
    ...rest,
    showDone: p.showDone ?? false,
    spaceId: p.spaceId ?? null,
  }
}

export function shapeTask(t: Doc<'tasks'>) {
  const {
    _id,
    _creationTime,
    userId: _userId,
    createdFrom: _createdFrom,
    ...rest
  } = t
  return {
    ...rest,
    projectId: t.projectId ?? NO_PROJECT_ID,
    reminderMinutes: t.reminderMinutes ?? null,
    durationMinutes: t.durationMinutes ?? null,
    repeat: t.repeat ?? null,
    addToCalendar: t.addToCalendar ?? false,
    calendarEventId: t.calendarEventId ?? null,
    calendarSyncIssue: t.calendarSyncIssue ?? null,
    importedFromEventId: t.importedFromEventId ?? null,
    assigneeId: t.assigneeId ?? null,
    spaceId: t.spaceId ?? null,
  }
}

export type Task = ReturnType<typeof shapeTask>
export type Project = ReturnType<typeof shapeProject>

export function noProjectBucket<T>(spaceId: string | null, tasks: Array<T>) {
  return {
    id: NO_PROJECT_ID,
    name: 'No project',
    color: 'slate',
    status: 'active' as const,
    collapsed: false,
    showDone: false,
    gridCol: -1,
    gridRow: 0,
    targetDate: null,
    createdAt: 0,
    finishedAt: null,
    shelvedAt: null,
    spaceId,
    tasks,
  }
}

export type NewTask = {
  id: string
  projectId: string
  spaceId: string | null
  title: string
  position: number
  parentId?: string | null
  notes?: string | null
  dueAt?: number | null
  durationMinutes?: number | null
  assigneeId?: string | null
  importedFromEventId?: string | null
}

export function newTask(input: NewTask, now: number): Task {
  return {
    id: input.id,
    projectId: input.projectId,
    parentId: input.parentId ?? null,
    title: input.title.trim(),
    notes: input.notes ?? null,
    position: input.position,
    done: false,
    doneAt: null,
    archived: false,
    dueAt: input.dueAt ?? null,
    reminderMinutes: null,
    durationMinutes: clampDuration(input.durationMinutes),
    repeat: null,
    addToCalendar: false,
    calendarEventId: null,
    calendarSyncIssue: null,
    importedFromEventId: input.importedFromEventId ?? null,
    inFocus: false,
    focusOrder: 0,
    createdAt: now,
    assigneeId: input.assigneeId ?? null,
    spaceId: input.spaceId,
  }
}

export function taskRow(task: Task, userId: string) {
  const { calendarSyncIssue, ...fields } = task
  return {
    ...fields,
    userId,
    projectId: storedProjectId(task.projectId),
    ...(calendarSyncIssue !== null && { calendarSyncIssue }),
  }
}

export type TaskUpdate = {
  title?: string
  notes?: string | null
  done?: boolean
  archived?: boolean
  assigneeId?: string | null
  dueAt?: number | null
  durationMinutes?: number | null
  reminderMinutes?: number | null
  addToCalendar?: boolean
  repeat?: RepeatRule | null
}

export type TaskPatch = Partial<
  Pick<
    Task,
    | 'title'
    | 'notes'
    | 'done'
    | 'doneAt'
    | 'archived'
    | 'assigneeId'
    | 'dueAt'
    | 'durationMinutes'
    | 'reminderMinutes'
    | 'addToCalendar'
    | 'calendarSyncIssue'
    | 'repeat'
  >
>

export function applyTaskUpdate(
  task: Pick<Task, 'dueAt' | 'repeat' | 'doneAt'>,
  update: TaskUpdate,
  clock: { now: number; timeZone: string },
): TaskPatch {
  const patch: TaskPatch = {}
  const title = update.title?.trim()
  if (title) patch.title = title
  if (update.notes !== undefined) patch.notes = update.notes
  if (update.archived !== undefined) patch.archived = update.archived
  if (update.assigneeId !== undefined) patch.assigneeId = update.assigneeId
  if (update.reminderMinutes !== undefined)
    patch.reminderMinutes = update.reminderMinutes
  if (update.durationMinutes !== undefined)
    patch.durationMinutes = clampDuration(update.durationMinutes)
  if (update.addToCalendar !== undefined) {
    patch.addToCalendar = update.addToCalendar
    if (update.addToCalendar) patch.calendarSyncIssue = null
  }
  if (update.dueAt !== undefined) patch.dueAt = update.dueAt

  const dueAt = update.dueAt !== undefined ? update.dueAt : task.dueAt
  const series =
    dueAt === null ? null : update.repeat !== undefined ? update.repeat : task.repeat
  if (update.repeat !== undefined || update.dueAt === null)
    patch.repeat = series

  if (update.done === undefined) return patch
  const rolled =
    update.done && series !== null && dueAt !== null
      ? nextOccurrence(dueAt, series, clock.now, clock.timeZone)
      : null
  if (rolled !== null) {
    patch.dueAt = rolled
    patch.done = false
    patch.doneAt = null
    return patch
  }
  patch.done = update.done
  patch.doneAt = update.done ? clock.now : task.doneAt
  return patch
}

export function taskPatchRow(patch: TaskPatch) {
  const { calendarSyncIssue, ...fields } = patch
  if (calendarSyncIssue === undefined) return fields
  return { ...fields, calendarSyncIssue: calendarSyncIssue ?? undefined }
}

export function descendants<T extends { id: string; parentId: string | null }>(
  tasks: Array<T>,
  rootId: string,
): Array<T> {
  const childrenOf = new Map<string, Array<T>>()
  for (const task of tasks) {
    if (!task.parentId) continue
    const siblings = childrenOf.get(task.parentId)
    if (siblings) siblings.push(task)
    else childrenOf.set(task.parentId, [task])
  }
  const found: Array<T> = []
  const seen = new Set([rootId])
  const queue = [...(childrenOf.get(rootId) ?? [])]
  for (let index = 0; index < queue.length; index++) {
    const next = queue[index]
    if (seen.has(next.id)) continue
    seen.add(next.id)
    found.push(next)
    queue.push(...(childrenOf.get(next.id) ?? []))
  }
  return found
}
