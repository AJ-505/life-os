import { describe, expect, it } from 'vitest'

import {
  changeLabel,
  dueLabel,
  headline,
  isPercentGoal,
  paceLabel,
} from './goal-display'
import { sparkPoints } from './Sparkline'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date(2026, 10, 27, 12).getTime()

const percent = { target: 100, unit: null }
const books = { target: 24, unit: 'books' }

describe('headline', () => {
  it('shows a percent goal as one big percent', () => {
    expect(isPercentGoal(percent)).toBe(true)
    expect(headline(percent, 62)).toEqual({ big: '62%', of: null, percent: 62 })
  })

  it('shows a number goal as the amount out of its target', () => {
    expect(isPercentGoal(books)).toBe(false)
    expect(headline(books, 9)).toEqual({
      big: '9',
      of: 'of 24 books',
      percent: 38,
    })
    expect(headline({ target: 100, unit: 'km' }, 12.5).of).toBe('of 100 km')
  })
})

describe('changeLabel', () => {
  it('signs the change and names the unit of a percent goal', () => {
    expect(changeLabel(percent, 8)).toBe('+8% this week')
    expect(changeLabel(books, -2)).toBe('−2 this week')
    expect(changeLabel(books, 0)).toBe('No change this week')
  })
})

describe('paceLabel', () => {
  const goal = {
    target: 100,
    createdAt: NOW - 50 * DAY,
    targetDate: NOW + 50 * DAY,
  }

  it('compares progress with an even pace to the target date', () => {
    expect(paceLabel(goal, 50, NOW)).toEqual({ text: 'On pace', behind: false })
    expect(paceLabel(goal, 62, NOW)).toEqual({
      text: '12% ahead',
      behind: false,
    })
    expect(paceLabel(goal, 30, NOW)).toEqual({
      text: '20% behind',
      behind: true,
    })
  })

  it('has nothing to say without a target date', () => {
    expect(paceLabel({ ...goal, targetDate: null }, 30, NOW)).toBeNull()
  })
})

describe('dueLabel', () => {
  it('counts the days left on the calendar', () => {
    expect(dueLabel(NOW + 34 * DAY, NOW)).toBe('31 Dec 2026 · 34 days left')
    expect(dueLabel(NOW + DAY, NOW)).toBe('28 Nov 2026 · tomorrow')
    expect(dueLabel(NOW, NOW)).toBe('27 Nov 2026 · today')
    expect(dueLabel(NOW - DAY, NOW)).toBe('26 Nov 2026 · passed')
  })
})

describe('sparkPoints', () => {
  it('draws steps from the first point to now', () => {
    const history = [
      { value: 0, at: NOW - 10 * DAY },
      { value: 50, at: NOW - 5 * DAY },
    ]
    expect(sparkPoints(history, 100, 100, NOW)).toEqual([
      [0, 23],
      [50, 23],
      [50, 12],
      [100, 12],
      [100, 1],
    ])
  })

  it('stays inside the box when a point is newer than the clock', () => {
    const history = [
      { value: 0, at: NOW - 1000 },
      { value: 12, at: NOW + 30_000 },
    ]
    const xs = sparkPoints(history, 12, 100, NOW).map(([x]) => x)
    expect(Math.max(...xs)).toBe(100)
  })

  it('draws a flat line for a goal with one point', () => {
    const points = sparkPoints([{ value: 0, at: NOW }], 0, 100, NOW)
    expect(points.map(([, y]) => y)).toEqual([23, 23, 23])
  })
})
