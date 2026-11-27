import { describe, expect, it } from 'vitest'

import {
  CHECKIN_MERGE_MS,
  HISTORY_POINTS,
  WEEK_MS,
  changesProgress,
  expectedShare,
  goalEdit,
  percentOf,
  progressPatch,
  sliderStep,
  weeklyChange,
  withCheckin,
} from './goalModel'

const NOW = Date.UTC(2026, 10, 27, 12)

describe('progressPatch', () => {
  it('rounds to hundredths and clamps to the range', () => {
    const goal = { target: 10, reachedAt: null }
    expect(progressPatch(goal, 3.14159, NOW).current).toBe(3.14)
    expect(progressPatch(goal, -1, NOW).current).toBe(0)
    expect(progressPatch(goal, Number.NaN, NOW).current).toBe(0)
    expect(progressPatch(goal, 11, NOW)).toEqual({
      current: 10,
      reachedAt: NOW,
      updatedAt: NOW,
    })
  })

  it('keeps the first reached time and clears it below the target', () => {
    const reached = { target: 10, reachedAt: NOW - 1000 }
    expect(progressPatch(reached, 10, NOW).reachedAt).toBe(NOW - 1000)
    expect(progressPatch(reached, 9, NOW).reachedAt).toBeNull()
  })
})

describe('changesProgress', () => {
  it('is false for the same value on the same side of the target', () => {
    expect(
      changesProgress({ current: 5, target: 10, reachedAt: null }, 5),
    ).toBe(false)
    expect(
      changesProgress({ current: 10, target: 10, reachedAt: NOW }, 12),
    ).toBe(false)
  })

  it('is true for a new value', () => {
    expect(
      changesProgress({ current: 5, target: 10, reachedAt: null }, 6),
    ).toBe(true)
  })

  it('is true when a reopened goal at its target is marked reached again', () => {
    expect(
      changesProgress({ current: 10, target: 10, reachedAt: null }, 10),
    ).toBe(true)
  })
})

describe('withCheckin', () => {
  it('replaces the last point when it is recent, and appends when it is not', () => {
    const start = [{ value: 0, at: NOW - CHECKIN_MERGE_MS }]
    const appended = withCheckin(start, 5, NOW)
    expect(appended).toEqual([...start, { value: 5, at: NOW }])
    expect(withCheckin(appended, 7, NOW + 1000)).toEqual([
      ...start,
      { value: 7, at: NOW + 1000 },
    ])
  })

  it('never merges a move into the start point', () => {
    const start = [{ value: 0, at: NOW }]
    const moved = withCheckin(start, 62, NOW + 1000)
    expect(moved).toEqual([...start, { value: 62, at: NOW + 1000 }])
    expect(weeklyChange({ current: 62, history: moved }, NOW + 1000)).toBe(62)
  })

  it('keeps only the newest points', () => {
    const long = Array.from({ length: HISTORY_POINTS }, (_, i) => ({
      value: i,
      at: i * CHECKIN_MERGE_MS,
    }))
    const next = withCheckin(long, 99, NOW)
    expect(next).toHaveLength(HISTORY_POINTS)
    expect(next.at(-1)).toEqual({ value: 99, at: NOW })
    expect(next[0].value).toBe(1)
  })
})

describe('weeklyChange', () => {
  it('measures from the last point at least a week old', () => {
    const history = [
      { value: 2, at: NOW - 3 * WEEK_MS },
      { value: 10, at: NOW - WEEK_MS - 1 },
      { value: 30, at: NOW - 1000 },
    ]
    expect(weeklyChange({ current: 30, history }, NOW)).toBe(20)
  })

  it('measures from the start for a goal younger than a week', () => {
    const history = [
      { value: 0, at: NOW - 1000 },
      { value: 12, at: NOW },
    ]
    expect(weeklyChange({ current: 12, history }, NOW)).toBe(12)
    expect(weeklyChange({ current: 0, history: [] }, NOW)).toBe(0)
  })
})

describe('goalEdit', () => {
  it('only touches the fields it is given', () => {
    expect(goalEdit({ current: 5, target: 10 }, { color: 'sea' })).toEqual({
      color: 'sea',
    })
  })

  it('clamps progress to a new, smaller target', () => {
    expect(goalEdit({ current: 8, target: 10 }, { target: 4 })).toEqual({
      target: 4,
      current: 4,
    })
  })
})

describe('percentOf', () => {
  it('rounds to a whole percent', () => {
    expect(percentOf({ current: 1, target: 3 })).toBe(33)
    expect(percentOf({ current: 9, target: 24 })).toBe(38)
  })
})

describe('expectedShare', () => {
  const DAY = 24 * 60 * 60 * 1000

  it('is the share of the time from start to target date that has passed', () => {
    const goal = { createdAt: NOW - 10 * DAY, targetDate: NOW + 30 * DAY }
    expect(expectedShare(goal, NOW)).toBe(0.25)
    expect(expectedShare(goal, NOW + 60 * DAY)).toBe(1)
    expect(expectedShare(goal, NOW - 20 * DAY)).toBe(0)
  })

  it('has no pace without a target date after the start', () => {
    expect(expectedShare({ createdAt: NOW, targetDate: null }, NOW)).toBeNull()
    expect(
      expectedShare({ createdAt: NOW, targetDate: NOW - DAY }, NOW),
    ).toBeNull()
  })
})

describe('sliderStep', () => {
  it('moves in whole steps unless the target needs a fraction', () => {
    expect(sliderStep(24)).toBe(1)
    expect(sliderStep(7.5)).toBe(0.01)
  })
})
