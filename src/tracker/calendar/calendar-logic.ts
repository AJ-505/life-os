import { addDays } from 'date-fns/addDays'
import { format } from 'date-fns/format'
import { startOfDay } from 'date-fns/startOfDay'
import { startOfWeek } from 'date-fns/startOfWeek'

import { activeProjects } from '../board/board-logic'

import type { BoardData, ProjectWithTasks, Task } from '../types'

export const HOUR_PX = 48
export const EVENT_MINUTES = 60
export const SNAP_MINUTES = 15
const DAY_MINUTES = 24 * 60

export const dayId = (dayStart: number) => `day@${dayStart}`
export const allDayId = (dayStart: number) => `allday@${dayStart}`
export const calTaskId = (id: string) => `cal@${id}`

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

/** The wall-clock label the grid uses, shared so the external cards read in
 *  the same voice as the task cards. */
export function timeLabel(minute: number): string {
  return format(atMinute(0, minute), minute % 60 === 0 ? 'h a' : 'h:mm a')
}

export function isAllDay(at: number): boolean {
  return minuteOfDay(at) === 0
}

export function atMinute(dayStart: number, minutes: number): number {
  const date = new Date(dayStart)
  date.setHours(0, minutes, 0, 0)
  return date.getTime()
}

export function dropMinute(offsetPx: number): number {
  const raw = (offsetPx / HOUR_PX) * 60
  const snapped = Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES
  return Math.min(Math.max(snapped, SNAP_MINUTES), DAY_MINUTES - SNAP_MINUTES)
}

export type CalendarTask = { task: Task; project: ProjectWithTasks }

/** The event rows pulled back from Google Calendar (the cache behind these
 *  lives in `convex/calendarEvents`). Read-only by design: an external event
 *  is Google's, so it cannot be dragged, resized or completed here — it can
 *  only be converted into a task, which is an explicit click. */
export type ExternalEvent = {
  eventId: string
  title: string
  notes: string | null
  location: string | null
  allDay: boolean
  start: number
  end: number
  link: string | null
}

/** One timed grid entry: an owned task or a pulled-back external event. The
 *  two live in the same lane placement so one column reads as one timeline. */
export type TimedEntry =
  | { kind: 'task'; task: Task; project: ProjectWithTasks }
  | { kind: 'external'; event: ExternalEvent }

export type PlacedTask = TimedEntry & {
  start: number
  minutes: number
  lane: number
  lanes: number
}

export type CalendarDay = {
  start: number
  allDay: Array<CalendarTask>
  externalAllDay: Array<ExternalEvent>
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
): number {
  const raw = startMinutes + (deltaPx / HOUR_PX) * 60
  const snapped = Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES
  return Math.min(
    Math.max(snapped, SNAP_MINUTES),
    Math.max(DAY_MINUTES - startMinute, SNAP_MINUTES),
  )
}

/** Every timed entry carries its own `minutes` before placement: a task takes
 *  `taskMinutes`, an external event takes the exposed window length. One
 *  placement pass over both keeps a task and an external event that share a
 *  slot side by side instead of drawn on top of each other. */
export function placeInLanes<T extends { start: number; minutes: number }>(
  items: Array<T>,
): Array<T & { lane: number; lanes: number }> {
  const sorted = [...items].sort(
    (a, b) => a.start - b.start || a.minutes - b.minutes,
  )
  const placed: Array<T & { lane: number; lanes: number }> = []
  let cluster: Array<T & { lane: number; lanes: number }> = []
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
    laneEnds[lane] = item.start + item.minutes
    clusterEnd = Math.max(clusterEnd, item.start + item.minutes)
    const entry = { ...item, lane, lanes: 1 }
    cluster.push(entry)
    placed.push(entry)
  }
  closeCluster()
  return placed
}

/** What an external event contributes to one day column, or null when it does
 *  not touch that day. A block that runs past midnight is clipped at the day
 *  edge: the day it starts in keeps the tail, and the next day redraws from
 *  midnight, which is how the task grid treats an over-midnight task block. */
export function externalPlacement(
  event: ExternalEvent,
  dayStart: number,
): { allDay: true } | { allDay: false; start: number; minutes: number } | null {
  const dayEnd = dayStart + 86_400_000
  if (event.end <= dayStart || event.start >= dayEnd) return null
  if (event.allDay) return { allDay: true }
  const segmentStart = Math.max(event.start, dayStart)
  const segmentEnd = Math.min(event.end, dayEnd)
  const minutes = Math.max(15, Math.round((segmentEnd - segmentStart) / 60_000))
  return { allDay: false, start: minuteOfDay(segmentStart), minutes }
}

/** Every event id a board task was imported from. The overlay hides an event
 *  whose import the user already kept — and reveals it again if that task is
 *  deleted, which is the re-import path, not a bug. */
export function importedEventIds(board: BoardData): Set<string> {
  const ids = new Set<string>()
  for (const project of board) {
    for (const task of project.tasks) {
      const id = task.importedFromEventId
      if (id) ids.add(id)
    }
  }
  return ids
}

export function calendarWeek(
  board: BoardData,
  days: Array<Date>,
  showDone: boolean,
  external: Array<ExternalEvent> = [],
): Array<CalendarDay> {
  const starts = days.map((d) => startOfDay(d).getTime())
  const buckets = new Map(
    starts.map((start) => [
      start,
      {
        allDay: [] as Array<CalendarTask>,
        externalAllDay: [] as Array<ExternalEvent>,
        milestones: [] as Array<ProjectWithTasks>,
        timed: [] as Array<TimedEntry & { start: number; minutes: number }>,
      },
    ]),
  )

  for (const project of activeProjects(board)) {
    if (project.targetDate !== null) {
      buckets
        .get(startOfDay(project.targetDate).getTime())
        ?.milestones.push(project)
    }
    for (const task of project.tasks) {
      if (task.dueAt === null || task.archived) continue
      if (task.done && !showDone) continue
      const bucket = buckets.get(startOfDay(task.dueAt).getTime())
      if (!bucket) continue
      if (isAllDay(task.dueAt)) bucket.allDay.push({ task, project })
      else
        bucket.timed.push({
          kind: 'task',
          task,
          project,
          start: minuteOfDay(task.dueAt),
          minutes: taskMinutes(task),
        })
    }
  }

  for (const event of external) {
    for (const start of starts) {
      const placement = externalPlacement(event, start)
      if (!placement) continue
      const bucket = buckets.get(start)!
      if (placement.allDay) bucket.externalAllDay.push(event)
      else
        bucket.timed.push({
          kind: 'external',
          event,
          start: placement.start,
          minutes: placement.minutes,
        })
    }
  }

  return starts.map((start) => {
    const bucket = buckets.get(start)!
    return {
      start,
      allDay: bucket.allDay,
      externalAllDay: bucket.externalAllDay.sort(
        (a, b) => a.title.localeCompare(b.title) || a.start - b.start,
      ),
      milestones: bucket.milestones,
      timed: placeInLanes(bucket.timed),
    }
  })
}
