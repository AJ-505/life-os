import { addDays } from 'date-fns/addDays'
import { startOfDay } from 'date-fns/startOfDay'
import { startOfWeek } from 'date-fns/startOfWeek'

import { localTimeZone, occurrencesBetween } from '../../../convex/recurrence'
import { activeProjects } from '../board/board-logic'

import type { BoardData, ProjectWithTasks, Task } from '../types'

export const HOUR_PX = 48
export const EVENT_MINUTES = 60
export const SNAP_MINUTES = 15
const DAY_MINUTES = 24 * 60

/**
 * Slot sizes the calendar can draw. The hour keeps a readable height by
 * stretching when a block would otherwise be shorter than MIN_BLOCK_PX, so a
 * 10 minute grid has 16px rows instead of 8px slivers.
 */
export const BLOCK_MINUTES = [10, 15, 20, 30, 60] as const
export type BlockMinutes = (typeof BLOCK_MINUTES)[number]
export const DEFAULT_BLOCK_MINUTES: BlockMinutes = 60
const MIN_BLOCK_PX = 16

export function normalizeBlockMinutes(value: number): BlockMinutes {
  return (
    BLOCK_MINUTES.find((minutes) => minutes === value) ?? DEFAULT_BLOCK_MINUTES
  )
}

export function blockShortLabel(minutes: number): string {
  return minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`
}

export function hourPxFor(blockMinutes: number): number {
  const perBlock = (HOUR_PX * blockMinutes) / 60
  return perBlock >= MIN_BLOCK_PX ? HOUR_PX : (MIN_BLOCK_PX * 60) / blockMinutes
}

export function labelStep(blockMinutes: number): number {
  return [30, 60].find((step) => step % blockMinutes === 0) ?? 60
}

export const dayId = (dayStart: number) => `day@${dayStart}`
export const allDayId = (dayStart: number) => `allday@${dayStart}`
export const calTaskId = (id: string, occurrence?: number) =>
  occurrence === undefined ? `cal@${id}` : `cal@${id}@${occurrence}`

export function weekDays(anchor: Date): Array<Date> {
  const first = startOfWeek(anchor, { weekStartsOn: 1 })
  return Array.from({ length: 7 }, (_, i) => addDays(first, i))
}

export function visibleDays(anchor: Date, span: number): Array<Date> {
  if (span === 7) return weekDays(anchor)
  const first = startOfDay(anchor)
  return Array.from({ length: span }, (_, i) => addDays(first, i))
}

export function minuteOfDay(at: number): number {
  const date = new Date(at)
  return date.getHours() * 60 + date.getMinutes()
}

export function isAllDay(at: number): boolean {
  return minuteOfDay(at) === 0
}

export function atMinute(dayStart: number, minutes: number): number {
  const date = new Date(dayStart)
  date.setHours(0, minutes, 0, 0)
  return date.getTime()
}

export function dropMinute(
  offsetPx: number,
  blockMinutes: number = DEFAULT_BLOCK_MINUTES,
  hourPx: number = HOUR_PX,
): number {
  const step = Math.min(blockMinutes, SNAP_MINUTES)
  const raw = (offsetPx / hourPx) * 60
  const snapped = Math.round(raw / step) * step
  return Math.min(Math.max(snapped, step), DAY_MINUTES - step)
}

/** The block a click at `offsetPx` inside a day column lands on. Grid blocks
 *  above half an hour keep the half-hour placement the calendar always had, so
 *  choosing the hourly default loses no precision. */
export function slotMinute(offsetPx: number, blockMinutes: number): number {
  const step = Math.min(blockMinutes, 30)
  const raw = (offsetPx / hourPxFor(blockMinutes)) * 60
  const snapped = Math.floor(raw / step) * step
  return Math.min(Math.max(snapped, 0), DAY_MINUTES - blockMinutes)
}

export type CalendarTask = {
  task: Task
  project: ProjectWithTasks
  occurrence: number
}

export type PlacedTask = CalendarTask & {
  start: number
  minutes: number
  lane: number
  lanes: number
}

export type CalendarDay = {
  start: number
  allDay: Array<CalendarTask>
  milestones: Array<ProjectWithTasks>
  timed: Array<PlacedTask>
}

export function taskMinutes(task: Task): number {
  return task.durationMinutes ?? EVENT_MINUTES
}

export function durationUntil(
  startMinute: number,
  endMinute: number,
): number | null {
  return endMinute > startMinute ? endMinute - startMinute : null
}

export function resizedMinutes(
  startMinute: number,
  startMinutes: number,
  deltaPx: number,
  blockMinutes: number = DEFAULT_BLOCK_MINUTES,
  hourPx: number = HOUR_PX,
): number {
  const step = Math.min(blockMinutes, SNAP_MINUTES)
  const raw = startMinutes + (deltaPx / hourPx) * 60
  const snapped = Math.round(raw / step) * step
  return Math.min(
    Math.max(snapped, step),
    Math.max(DAY_MINUTES - startMinute, step),
  )
}

export function placeInLanes(
  items: Array<CalendarTask & { start: number }>,
): Array<PlacedTask> {
  const sorted = [...items].sort(
    (a, b) => a.start - b.start || a.task.title.localeCompare(b.task.title),
  )
  const placed: Array<PlacedTask> = []
  let cluster: Array<PlacedTask> = []
  let laneEnds: Array<number> = []
  let clusterEnd = -1

  const closeCluster = () => {
    for (const item of cluster) item.lanes = laneEnds.length
    cluster = []
    laneEnds = []
  }

  for (const item of sorted) {
    if (item.start >= clusterEnd) closeCluster()
    const free = laneEnds.findIndex((end) => end <= item.start)
    const lane = free === -1 ? laneEnds.length : free
    const minutes = taskMinutes(item.task)
    laneEnds[lane] = item.start + minutes
    clusterEnd = Math.max(clusterEnd, item.start + minutes)
    const entry = { ...item, minutes, lane, lanes: 1 }
    cluster.push(entry)
    placed.push(entry)
  }
  closeCluster()
  return placed
}

export function calendarWeek(
  board: BoardData,
  days: Array<Date>,
  showDone: boolean,
): Array<CalendarDay> {
  const starts = days.map((d) => startOfDay(d).getTime())
  const buckets = new Map(
    starts.map((start) => [
      start,
      {
        allDay: [] as Array<CalendarTask>,
        milestones: [] as Array<ProjectWithTasks>,
        timed: [] as Array<CalendarTask & { start: number }>,
      },
    ]),
  )
  const from = starts[0] ?? 0
  const last = days.at(-1)
  const to = last ? addDays(last, 1).getTime() : 0
  const timeZone = localTimeZone()

  for (const project of activeProjects(board)) {
    if (project.targetDate !== null) {
      buckets
        .get(startOfDay(project.targetDate).getTime())
        ?.milestones.push(project)
    }
    for (const task of project.tasks) {
      if (task.dueAt === null || task.archived) continue
      if (task.done && !showDone) continue
      const occurrences =
        task.repeat === null
          ? [task.dueAt]
          : occurrencesBetween(task.dueAt, task.repeat, from, to, timeZone)
      for (const occurrence of occurrences) {
        const bucket = buckets.get(startOfDay(occurrence).getTime())
        if (!bucket) continue
        if (isAllDay(occurrence))
          bucket.allDay.push({ task, project, occurrence })
        else
          bucket.timed.push({
            task,
            project,
            occurrence,
            start: minuteOfDay(occurrence),
          })
      }
    }
  }

  return starts.map((start) => {
    const bucket = buckets.get(start)!
    return {
      start,
      allDay: bucket.allDay,
      milestones: bucket.milestones,
      timed: placeInLanes(bucket.timed),
    }
  })
}
