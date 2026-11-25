import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays'
import { format } from 'date-fns/format'
import { isToday } from 'date-fns/isToday'
import { isTomorrow } from 'date-fns/isTomorrow'
import { startOfDay } from 'date-fns/startOfDay'

export const DEFAULT_DUE_TIME = '09:00'

export const DUE_BUCKETS = [
  'Overdue',
  'This hour',
  'Today',
  'Tomorrow',
  'This week',
  'Later',
] as const

export type DueBucket = (typeof DUE_BUCKETS)[number]

export function isAllDay(at: number | Date): boolean {
  const date = new Date(at)
  return date.getHours() === 0 && date.getMinutes() === 0
}

export function isOverdue(
  due: number | Date,
  now: number | Date = Date.now(),
): boolean {
  const at = new Date(due)
  if (isAllDay(at)) return startOfDay(now).getTime() > at.getTime()
  return at.getTime() < new Date(now).getTime()
}

export function dueBucket(due: number | Date, now: number | Date): DueBucket {
  const at = new Date(due)
  const current = new Date(now)
  if (isOverdue(at, current)) return 'Overdue'
  if (isToday(at) && !isAllDay(at) && at.getHours() === current.getHours())
    return 'This hour'
  if (isToday(at)) return 'Today'
  if (isTomorrow(at)) return 'Tomorrow'
  if (differenceInCalendarDays(at, current) < 7) return 'This week'
  return 'Later'
}

export function parseTime24(text: string): { h: number; m: number } | null {
  const match = text.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h > 23 || m > 59) return null
  return { h, m }
}

export function formatTime24(at: number | Date): string {
  return format(at, 'HH:mm')
}

export function withTime(day: number | Date, time: string): number {
  const parsed = parseTime24(time) ?? parseTime24(DEFAULT_DUE_TIME)!
  const combined = new Date(day)
  combined.setHours(parsed.h, parsed.m, 0, 0)
  return combined.getTime()
}
