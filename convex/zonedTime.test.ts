import { describe, expect, it } from 'vitest'

import {
  civilAt,
  dayStartIn,
  daysBetween,
  instantAt,
  isMidnight,
  utcOffset,
  wallClock,
} from './zonedTime'

describe('zoned time', () => {
  it('reads the wall clock and offset in a zone', () => {
    const instant = Date.UTC(2026, 6, 1, 8, 30)
    expect(wallClock(instant, 'Europe/Berlin')).toBe('2026-07-01T10:30:00')
    expect(utcOffset(instant, 'Europe/Berlin')).toBe('+02:00')
    expect(utcOffset(instant, 'America/New_York')).toBe('-04:00')
    expect(utcOffset(instant, 'Asia/Kolkata')).toBe('+05:30')
    expect(utcOffset(instant, 'UTC')).toBe('+00:00')
  })

  it('round trips a civil time through an instant', () => {
    const civil = civilAt(Date.UTC(2026, 2, 29, 1, 15), 'Europe/London')
    expect(instantAt(civil, 'Europe/London')).toBe(
      Date.UTC(2026, 2, 29, 1, 15),
    )
  })

  it('names midnight as the all-day mark in the zone', () => {
    const lagosMidnight = Date.UTC(2026, 9, 14, 23)
    expect(isMidnight(lagosMidnight, 'Africa/Lagos')).toBe(true)
    expect(isMidnight(lagosMidnight, 'UTC')).toBe(false)
  })

  it('finds the start of a day across a DST change', () => {
    expect(dayStartIn('2026-03-29', 'Europe/Berlin')).toBe(
      Date.UTC(2026, 2, 28, 23),
    )
    expect(dayStartIn('2026-03-30', 'Europe/Berlin')).toBe(
      Date.UTC(2026, 2, 29, 22),
    )
  })

  it('counts whole days between two dates', () => {
    expect(daysBetween('2026-03-28', '2026-03-31')).toBe(3)
    expect(daysBetween('bad', '2026-03-31')).toBe(1)
  })
})
