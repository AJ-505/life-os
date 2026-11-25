import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  dueBucket,
  formatTime24,
  isAllDay,
  isOverdue,
  parseTime24,
  withTime,
} from './due'

const NOW = new Date(2026, 10, 24, 15, 30).getTime()
const at = (day: number, h = 0, m = 0) =>
  new Date(2026, 10, day, h, m).getTime()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('isOverdue', () => {
  it('keeps an all-day task for today open all day', () => {
    expect(isOverdue(at(24), NOW)).toBe(false)
    expect(isOverdue(at(24), at(24, 23, 59))).toBe(false)
  })

  it('marks an all-day task from yesterday overdue', () => {
    expect(isOverdue(at(23), NOW)).toBe(true)
  })

  it('marks a timed task overdue once its time passes, even today', () => {
    expect(isOverdue(at(24, 14), NOW)).toBe(true)
    expect(isOverdue(at(24, 16), NOW)).toBe(false)
  })
})

describe('dueBucket', () => {
  it('puts an all-day task for today in Today, not This hour or Overdue', () => {
    expect(dueBucket(at(24), NOW)).toBe('Today')
  })

  it('agrees with isOverdue for a timed task earlier today', () => {
    expect(dueBucket(at(24, 9), NOW)).toBe('Overdue')
  })

  it('sorts the rest of the week', () => {
    expect(dueBucket(at(24, 15, 50), NOW)).toBe('This hour')
    expect(dueBucket(at(24, 18), NOW)).toBe('Today')
    expect(dueBucket(at(25, 9), NOW)).toBe('Tomorrow')
    expect(dueBucket(at(28), NOW)).toBe('This week')
    expect(dueBucket(at(30, 9), NOW)).toBe('This week')
    expect(dueBucket(new Date(2026, 11, 2, 9).getTime(), NOW)).toBe('Later')
  })
})

describe('times of day', () => {
  it('treats midnight as all day', () => {
    expect(isAllDay(at(24))).toBe(true)
    expect(isAllDay(at(24, 0, 1))).toBe(false)
  })

  it('reads 24-hour times and refuses impossible ones', () => {
    expect(parseTime24(' 9:05 ')).toEqual({ h: 9, m: 5 })
    expect(parseTime24('24:00')).toBeNull()
    expect(parseTime24('12:60')).toBeNull()
    expect(parseTime24('noon')).toBeNull()
  })

  it('puts a time on a day, and falls back to the default time', () => {
    expect(withTime(at(24), '13:45')).toBe(at(24, 13, 45))
    expect(withTime(at(24, 18), 'bad')).toBe(at(24, 9))
    expect(formatTime24(at(24, 7, 3))).toBe('07:03')
  })
})
