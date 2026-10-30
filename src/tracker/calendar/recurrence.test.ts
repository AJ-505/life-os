import { describe, expect, it } from 'vitest'

import {
  REPEAT_RULES,
  isRepeatRule,
  nextOccurrence,
  occurrencesBetween,
  usableTimeZone,
} from '../../../convex/recurrence'

const at = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  Date.UTC(year, month - 1, day, hour, minute)

const window = (
  rule: Parameters<typeof occurrencesBetween>[1],
  anchor: number,
  from: number,
  to: number,
  timeZone = 'UTC',
) => occurrencesBetween(anchor, rule, from, to, timeZone)

describe('occurrencesBetween', () => {
  it('places a daily series on every day of the window', () => {
    const anchor = at(2026, 10, 26, 9)
    expect(
      window('daily', anchor, at(2026, 10, 26), at(2026, 10, 29, 23)),
    ).toEqual([
      at(2026, 10, 26, 9),
      at(2026, 10, 27, 9),
      at(2026, 10, 28, 9),
      at(2026, 10, 29, 9),
    ])
  })

  it('places a weekly series only on its weekday', () => {
    const anchor = at(2026, 10, 26, 9)
    expect(
      window('weekly', anchor, at(2026, 10, 26), at(2026, 11, 2, 23)),
    ).toEqual([at(2026, 10, 26, 9), at(2026, 11, 2, 9)])
  })

  it('skips Saturday and Sunday for a weekday series', () => {
    const anchor = at(2026, 10, 30, 9)
    expect(
      window('weekdays', anchor, at(2026, 10, 30), at(2026, 11, 3, 23)),
    ).toEqual([at(2026, 10, 30, 9), at(2026, 11, 2, 9), at(2026, 11, 3, 9)])
  })

  it('keeps the anchor time of day for a weekday series', () => {
    const anchor = at(2026, 10, 31, 14, 30)
    const [first] = window(
      'weekdays',
      anchor,
      at(2026, 10, 31),
      at(2026, 11, 3),
    )
    expect(first).toBe(at(2026, 11, 2, 14, 30))
  })

  it('clamps a month-end series without drifting off the anchor day', () => {
    const anchor = at(2026, 1, 31, 9)
    expect(
      window('monthly', anchor, at(2026, 2, 1), at(2026, 2, 28, 23)),
    ).toEqual([at(2026, 2, 28, 9)])
    expect(
      window('monthly', anchor, at(2026, 3, 1), at(2026, 3, 31, 23)),
    ).toEqual([at(2026, 3, 31, 9)])
  })

  it('returns nothing before the anchor or outside the window', () => {
    const anchor = at(2026, 10, 26, 9)
    expect(window('weekly', anchor, at(2026, 10, 1), at(2026, 10, 25))).toEqual(
      [],
    )
    expect(window('weekly', anchor, at(2026, 10, 27), at(2026, 11, 1))).toEqual(
      [],
    )
  })

  it('finds the series when the window is far from its start', () => {
    const anchor = at(2020, 1, 1, 8)
    expect(
      window('weekly', anchor, at(2026, 10, 28), at(2026, 11, 3, 23)),
    ).toEqual([at(2026, 10, 28, 8)])
  })

  it('keeps the wall clock across a daylight saving change', () => {
    const anchor = Date.UTC(2026, 9, 24, 8)
    const found = window(
      'daily',
      anchor,
      anchor,
      Date.UTC(2026, 9, 27, 23),
      'Europe/London',
    )
    expect(found).toEqual([
      Date.UTC(2026, 9, 24, 8),
      Date.UTC(2026, 9, 25, 9),
      Date.UTC(2026, 9, 26, 9),
      Date.UTC(2026, 9, 27, 9),
    ])
  })

  it('treats an unusable zone as UTC', () => {
    const anchor = at(2026, 10, 26, 9)
    expect(
      window(
        'daily',
        anchor,
        at(2026, 10, 26),
        at(2026, 10, 26, 23),
        'Nowhere',
      ),
    ).toEqual([at(2026, 10, 26, 9)])
  })
})

const next = (
  anchor: number,
  rule: Parameters<typeof nextOccurrence>[1],
  after: number,
) => nextOccurrence(anchor, rule, after, 'UTC')

describe('nextOccurrence', () => {
  it('moves a weekly task one week on', () => {
    expect(next(at(2026, 10, 26, 9), 'weekly', at(2026, 10, 26, 9))).toBe(
      at(2026, 11, 2, 9),
    )
  })

  it('skips every missed day of an overdue daily task', () => {
    expect(next(at(2026, 10, 20, 9), 'daily', at(2026, 10, 30, 15))).toBe(
      at(2026, 10, 31, 9),
    )
  })

  it('moves a Friday weekday task to Monday', () => {
    expect(next(at(2026, 10, 30, 9), 'weekdays', at(2026, 10, 30, 9))).toBe(
      at(2026, 11, 2, 9),
    )
  })

  it('does not repeat the occurrence it is standing on when completed early', () => {
    expect(next(at(2026, 10, 26, 9), 'daily', at(2026, 10, 26, 7))).toBe(
      at(2026, 10, 27, 9),
    )
  })

  it('returns the next month-end after a clamped one', () => {
    expect(next(at(2026, 1, 31, 9), 'monthly', at(2026, 2, 28, 12))).toBe(
      at(2026, 3, 31, 9),
    )
  })

  it('keeps a leap day yearly series in step', () => {
    const leap = at(2024, 2, 29, 9)
    expect(next(leap, 'yearly', leap)).toBe(at(2025, 2, 28, 9))
    expect(next(leap, 'yearly', at(2027, 2, 28, 12))).toBe(at(2028, 2, 29, 9))
  })
})

describe('repeat rules', () => {
  it('accepts every rule and nothing else', () => {
    for (const rule of REPEAT_RULES) expect(isRepeatRule(rule)).toBe(true)
    expect(isRepeatRule('fortnightly')).toBe(false)
    expect(isRepeatRule(null)).toBe(false)
  })

  it('accepts a usable zone and rejects rubbish', () => {
    expect(usableTimeZone('Europe/London')).toBe('Europe/London')
    expect(usableTimeZone('Nowhere/Here')).toBeNull()
    expect(usableTimeZone(null)).toBeNull()
  })
})
