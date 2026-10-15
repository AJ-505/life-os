import { addDays } from 'date-fns/addDays'
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

export function dropMinute(offsetPx: number): number {
  const raw = (offsetPx / HOUR_PX) * 60
  const snapped = Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES
  return Math.min(Math.max(snapped, SNAP_MINUTES), DAY_MINUTES - SNAP_MINUTES)
}

export type CalendarTask = { task: Task; project: ProjectWithTasks }

export type PlacedTask = CalendarTask & {
  start: number
  lane: number
  lanes: number
}

export type CalendarDay = {
  start: number
  allDay: Array<CalendarTask>
  milestones: Array<ProjectWithTasks>
  timed: Array<PlacedTask>
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
    laneEnds[lane] = item.start + EVENT_MINUTES
    clusterEnd = Math.max(clusterEnd, item.start + EVENT_MINUTES)
    const entry = { ...item, lane, lanes: 1 }
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
      else bucket.timed.push({ task, project, start: minuteOfDay(task.dueAt) })
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
