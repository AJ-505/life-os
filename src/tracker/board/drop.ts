import { addDays } from 'date-fns/addDays'
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays'

import {
  buildTaskIndex,
  columnProjects,
  focusTasks,
  visibleTasks,
} from './board-logic'
import { focusDrop, projectDrop, taskDrop } from './placement'

import type { BoardData } from '../types'

export type Side = 'before' | 'after'

export const projId = (id: string) => `proj@${id}`
export const taskId = (id: string) => `task@${id}`
export const focusItemId = (id: string) => `fitem@${id}`
export const colId = (n: number) => `col@${n}`
export const listId = (projectId: string) => `list@${projectId}`
export const dayId = (dayStart: number) => `day@${dayStart}`
export const allDayId = (dayStart: number) => `allday@${dayStart}`
export const calTaskId = (id: string, occurrence?: number) =>
  occurrence === undefined ? `cal@${id}` : `cal@${id}@${occurrence}`

const DRAG_KINDS = [
  'proj',
  'task',
  'fitem',
  'cal',
  'col',
  'list',
  'day',
  'allday',
] as const

type DragIdKind = (typeof DRAG_KINDS)[number]

export type DragId = {
  kind: DragIdKind | 'focuszone'
  key: string
  occurrence: number | null
}

const isDragKind = (kind: string): kind is DragIdKind =>
  DRAG_KINDS.some((k) => k === kind)

export function parseDragId(raw: string | number): DragId | null {
  const s = String(raw)
  if (s === 'focuszone') return { kind: 'focuszone', key: '', occurrence: null }
  const at = s.indexOf('@')
  if (at === -1) return null
  const kind = s.slice(0, at)
  if (!isDragKind(kind)) return null
  const key = s.slice(at + 1)
  if (kind !== 'cal') return { kind, key, occurrence: null }
  const split = key.lastIndexOf('@')
  if (split === -1) return { kind, key, occurrence: null }
  const occurrence = Number(key.slice(split + 1))
  return Number.isFinite(occurrence)
    ? { kind, key: key.slice(0, split), occurrence }
    : { kind, key, occurrence: null }
}

export type DropIntent =
  | { kind: 'moveProject'; id: string; gridCol: number; gridRow: number }
  | { kind: 'moveTask'; id: string; projectId: string; position: number }
  | { kind: 'focus'; id: string; focusOrder: number }
  | { kind: 'reschedule'; id: string; dueAt: number }

export type CalendarSlot = { kind: 'day' | 'allday'; dayStart: number }

export type DropInput = {
  board: BoardData
  showDone: boolean
  active: string | number
  over: string | number
  side: Side
  dropAt: (slot: CalendarSlot) => number
}

export function shiftSeries(
  anchor: number,
  occurrence: number,
  dropAt: number,
): number {
  const drop = new Date(dropAt)
  const moved = addDays(
    new Date(anchor),
    differenceInCalendarDays(drop, new Date(occurrence)),
  )
  moved.setHours(drop.getHours(), drop.getMinutes(), 0, 0)
  return moved.getTime()
}

function directionSide(
  ordered: Array<string>,
  activeKey: string,
  overKey: string,
): Side | null {
  const from = ordered.indexOf(activeKey)
  const to = ordered.indexOf(overKey)
  if (from === -1 || to === -1) return null
  return from < to ? 'after' : 'before'
}

function rescheduleIntent(
  input: DropInput,
  src: DragId,
  slot: CalendarSlot,
): DropIntent | null {
  const found = buildTaskIndex(input.board).get(src.key)
  if (!found) return null
  const { task } = found
  const dropAt = input.dropAt(slot)
  const dueAt =
    src.occurrence !== null && task.repeat !== null && task.dueAt !== null
      ? shiftSeries(task.dueAt, src.occurrence, dropAt)
      : dropAt
  if (dueAt === task.dueAt) return null
  return { kind: 'reschedule', id: task.id, dueAt }
}

function projectIntent(
  input: DropInput,
  src: DragId,
  dst: DragId,
): DropIntent | null {
  const { board } = input
  if (dst.kind === 'col') {
    const target = projectDrop(board, src.key, { kind: 'col', key: dst.key })
    return target && { kind: 'moveProject', id: src.key, ...target }
  }
  const overProject =
    dst.kind === 'proj' || dst.kind === 'list'
      ? dst.key
      : dst.kind === 'task'
        ? (buildTaskIndex(board).get(dst.key)?.project.id ?? null)
        : null
  if (!overProject || overProject === src.key) return null
  const column = board.find((p) => p.id === overProject)?.gridCol
  const ordered =
    column === undefined ? [] : columnProjects(board, column).map((p) => p.id)
  const side =
    dst.kind === 'proj'
      ? (directionSide(ordered, src.key, overProject) ?? input.side)
      : 'before'
  const target = projectDrop(
    board,
    src.key,
    { kind: 'proj', key: overProject },
    side,
  )
  return target && { kind: 'moveProject', id: src.key, ...target }
}

function focusIntent(
  input: DropInput,
  src: DragId,
  dst: DragId,
  side: Side,
): DropIntent {
  const over = {
    kind: dst.kind === 'fitem' ? 'fitem' : 'focuszone',
    key: dst.key,
  } as const
  return {
    kind: 'focus',
    id: src.key,
    focusOrder: focusDrop(input.board, src.key, over, side),
  }
}

function taskIntent(
  input: DropInput,
  src: DragId,
  dst: DragId,
): DropIntent | null {
  const { board, showDone } = input
  if (dst.kind === 'focuszone' || dst.kind === 'fitem')
    return focusIntent(
      input,
      src,
      dst,
      dst.kind === 'fitem' ? input.side : 'before',
    )
  const over =
    dst.kind === 'proj' || dst.kind === 'list'
      ? ({ kind: 'list', key: dst.key } as const)
      : dst.kind === 'task'
        ? ({ kind: 'task', key: dst.key } as const)
        : null
  if (!over) return null
  const overProject =
    over.kind === 'task'
      ? board.find((p) => p.tasks.some((t) => t.id === over.key))
      : undefined
  const ordered = overProject
    ? visibleTasks(overProject, showDone || overProject.showDone).map(
        (t) => t.id,
      )
    : []
  const side =
    over.kind === 'task'
      ? (directionSide(ordered, src.key, over.key) ?? input.side)
      : 'before'
  const target = taskDrop(board, src.key, over, showDone, side)
  return target && { kind: 'moveTask', id: src.key, ...target }
}

function focusReorderIntent(
  input: DropInput,
  src: DragId,
  dst: DragId,
): DropIntent | null {
  if (dst.kind !== 'focuszone' && dst.kind !== 'fitem') return null
  const ordered = focusTasks(input.board).map((entry) => entry.task.id)
  const side =
    dst.kind === 'fitem'
      ? (directionSide(ordered, src.key, dst.key) ?? input.side)
      : 'before'
  return focusIntent(input, src, dst, side)
}

export function resolveDrop(input: DropInput): DropIntent | null {
  const src = parseDragId(input.active)
  const dst = parseDragId(input.over)
  if (!src || !dst) return null
  const draggingTask =
    src.kind === 'task' || src.kind === 'cal' || src.kind === 'fitem'
  if (dst.kind === 'day' || dst.kind === 'allday')
    return draggingTask
      ? rescheduleIntent(input, src, {
          kind: dst.kind,
          dayStart: Number(dst.key),
        })
      : null
  if (src.kind === 'proj') return projectIntent(input, src, dst)
  if (src.kind === 'task' || src.kind === 'cal')
    return taskIntent(input, src, dst)
  if (src.kind === 'fitem') return focusReorderIntent(input, src, dst)
  return null
}
