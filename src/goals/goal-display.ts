import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays'
import { format } from 'date-fns/format'

import { PERCENT_TARGET, expectedShare } from '../../convex/goalModel'

import type { Goal } from '../../convex/goalModel'

type Measured = Pick<Goal, 'target' | 'unit'>

export const isPercentGoal = (goal: Measured) =>
  goal.unit === null && goal.target === PERCENT_TARGET

const amount = new Intl.NumberFormat('en', { maximumFractionDigits: 2 })

export const formatAmount = (value: number) => amount.format(value)

export const percentAt = (goal: Measured, value: number) =>
  Math.round((value / goal.target) * 100)

export function headline(goal: Measured, value: number) {
  const percent = percentAt(goal, value)
  if (isPercentGoal(goal)) return { big: `${percent}%`, of: null, percent }
  const unit = goal.unit ? ` ${goal.unit}` : ''
  return {
    big: formatAmount(value),
    of: `of ${formatAmount(goal.target)}${unit}`,
    percent,
  }
}

export function changeLabel(goal: Measured, change: number) {
  if (change === 0) return 'No change this week'
  const sign = change > 0 ? '+' : '−'
  const size = Math.abs(change)
  const shown = isPercentGoal(goal)
    ? `${formatAmount(size)}%`
    : formatAmount(size)
  return `${sign}${shown} this week`
}

export function paceLabel(
  goal: Pick<Goal, 'target' | 'createdAt' | 'targetDate'>,
  value: number,
  now: number,
) {
  const share = expectedShare(goal, now)
  if (share === null) return null
  const gap = Math.round(((value - share * goal.target) / goal.target) * 100)
  if (gap >= 5) return { text: `${gap}% ahead`, behind: false }
  if (gap > -5) return { text: 'On pace', behind: false }
  return { text: `${-gap}% behind`, behind: true }
}

export function dueLabel(targetDate: number, now: number) {
  const days = differenceInCalendarDays(targetDate, now)
  const date = format(targetDate, 'd MMM yyyy')
  if (days > 1) return `${date} · ${days} days left`
  if (days === 1) return `${date} · tomorrow`
  if (days === 0) return `${date} · today`
  return `${date} · passed`
}
