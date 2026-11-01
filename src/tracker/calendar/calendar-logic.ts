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

/**
 * Slot sizes the calendar can draw. A block always occupies the pixels the
 * hourly grid gives an hour, so a finer grid stretches the hour and the whole
 * day with it: a 15 minute grid is four times taller than the hourly one.
 */
export const BLOCK_MINUTES = [10, 15, 20, 30, 60] as const
export type BlockMinutes = (typeof BLOCK_MINUTES)[number]
export const DEFAULT_BLOCK_MINUTES: BlockMinutes = 30

export function normalizeBlockMinutes(value: number): BlockMinutes {
  return (
    BLOCK_MINUTES.find((minutes) => minutes === value) ?? DEFAULT_BLOCK_MINUTES
  )
}

export function blockShortLabel(minutes: number): string {
  return minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`
}

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

export function hourPxFor(blockMinutes: number): number {
  return (HOUR_PX * 60) / blockMinutes
}

export function labelStep(blockMinutes: number): number {
  return [30, 60].find((step) => step % blockMinutes === 0) ?? 60
}

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

export type CalendarTask = { task: Task; project: ProjectWithTasks }

/** The block range a press-drag covers: every block the pointer entered, from
 *  the block under the press to the block under the pointer, in either
 *  direction. Dragging through three 15 minute blocks selects 45 minutes. */
export function dragSpan(
  downPx: number,
  movePx: number,
  blockMinutes: number,
): { minute: number; minutes: number } {
  const blockPx = hourPxFor(blockMinutes) * (blockMinutes / 60)
  const lastBlock = DAY_MINUTES / blockMinutes - 1
  const blockAt = (px: number) =>
    Math.min(Math.max(Math.floor(px / blockPx), 0), lastBlock)
  const first = Math.min(blockAt(downPx), blockAt(movePx))
  const last = Math.max(blockAt(downPx), blockAt(movePx))
  return {
    minute: first * blockMinutes,
    minutes: (last - first + 1) * blockMinutes,
  }
}

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

/** How much text a card of `minutes` can carry when the hour is `hourPx`
 *  wide. Density runs on rendered pixels, never minutes: a one block task
 *  fills 48px on every grid (15 minutes on the 15 minute grid, an hour on
 *  the hourly one), so every freshly clicked card reads at full size, while
 *  15 minutes on the hourly grid is a 12px sliver that only fits the
 *  smallest text. Below `COMPACT_CARD_PX` the time label does not fit under
 *  the title; below `TIGHT_CARD_PX` even the title drops to the small font. */
export const COMPACT_CARD_PX = 38
export const TIGHT_CARD_PX = 20

export type CardDensity = 'full' | 'compact' | 'tight'

export function cardDensity(minutes: number, hourPx: number): CardDensity {
  const heightPx = (minutes / 60) * hourPx
  if (heightPx < TIGHT_CARD_PX) return 'tight'
  if (heightPx < COMPACT_CARD_PX) return 'compact'
  return 'full'
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
