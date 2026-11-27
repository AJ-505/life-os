import type { Doc } from './_generated/dataModel'

export const MAX_GOAL_TITLE = 120
export const MAX_GOAL_UNIT = 24
export const MAX_GOAL_TARGET = 1_000_000_000
export const PERCENT_TARGET = 100

export const CHECKIN_MERGE_MS = 15 * 60 * 1000
export const HISTORY_POINTS = 60
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export type Checkin = { value: number; at: number }

export type Goal = ReturnType<typeof shapeGoal> & { history: Array<Checkin> }

export type GoalFields = {
  title: string
  color: string
  target: number
  unit: string | null
  targetDate: number | null
}

export function shapeGoal(goal: Doc<'goals'>) {
  const { _id, _creationTime, userId: _userId, ...rest } = goal
  return rest
}

const hundredths = (value: number) => Math.round(value * 100) / 100

export function cleanTitle(title: string): string {
  const trimmed = title.trim().slice(0, MAX_GOAL_TITLE)
  if (!trimmed) throw new Error('A goal needs a title')
  return trimmed
}

export function cleanUnit(unit: string | null): string | null {
  const trimmed = unit?.trim().slice(0, MAX_GOAL_UNIT) ?? ''
  return trimmed || null
}

export function cleanTarget(target: number): number {
  if (!Number.isFinite(target) || target <= 0)
    throw new Error('A goal target must be more than zero')
  return Math.min(MAX_GOAL_TARGET, hundredths(target))
}

export function clampProgress(value: number, target: number): number {
  if (!Number.isFinite(value)) return 0
  return hundredths(Math.max(0, Math.min(target, value)))
}

export function percentOf(goal: Pick<Goal, 'current' | 'target'>): number {
  return Math.round((goal.current / goal.target) * 100)
}

export function progressPatch(
  goal: Pick<Goal, 'target' | 'reachedAt'>,
  value: number,
  now: number,
) {
  const current = clampProgress(value, goal.target)
  const reachedAt = current >= goal.target ? (goal.reachedAt ?? now) : null
  return { current, reachedAt, updatedAt: now }
}

export function changesProgress(
  goal: Pick<Goal, 'current' | 'target' | 'reachedAt'>,
  value: number,
) {
  const patch = progressPatch(goal, value, 0)
  return (
    patch.current !== goal.current ||
    (patch.reachedAt === null) !== (goal.reachedAt === null)
  )
}

export function mergesWithLast(newest: Array<Checkin>, now: number) {
  const [last, earlier] = newest
  return earlier !== undefined && now - last.at < CHECKIN_MERGE_MS
}

export function withCheckin(
  history: Array<Checkin>,
  value: number,
  now: number,
): Array<Checkin> {
  const point = { value, at: now }
  const kept = mergesWithLast(history.slice(-2).reverse(), now)
    ? history.slice(0, -1)
    : history
  return [...kept, point].slice(-HISTORY_POINTS)
}

export function weeklyChange(
  goal: Pick<Goal, 'current' | 'history'>,
  now: number,
) {
  const weekAgo = now - WEEK_MS
  const before = goal.history.filter((point) => point.at <= weekAgo).at(-1)
  const baseline = before ?? goal.history[0]
  if (!baseline) return 0
  return hundredths(goal.current - baseline.value)
}

export function newGoal(
  args: GoalFields & { id: string; position: number },
  now: number,
): Goal {
  return {
    id: args.id,
    title: cleanTitle(args.title),
    color: args.color,
    target: cleanTarget(args.target),
    unit: cleanUnit(args.unit),
    targetDate: args.targetDate,
    current: 0,
    position: args.position,
    createdAt: now,
    updatedAt: now,
    reachedAt: null,
    history: [{ value: 0, at: now }],
  }
}

export function goalEdit(
  goal: Pick<Goal, 'current' | 'target'>,
  edit: Partial<GoalFields>,
) {
  const target =
    edit.target === undefined ? goal.target : cleanTarget(edit.target)
  return {
    ...(edit.title !== undefined && { title: cleanTitle(edit.title) }),
    ...(edit.color !== undefined && { color: edit.color }),
    ...(edit.unit !== undefined && { unit: cleanUnit(edit.unit) }),
    ...(edit.targetDate !== undefined && { targetDate: edit.targetDate }),
    ...(edit.target !== undefined && {
      target,
      current: clampProgress(goal.current, target),
    }),
  }
}

export function expectedShare(
  goal: Pick<Goal, 'createdAt' | 'targetDate'>,
  now: number,
): number | null {
  if (goal.targetDate === null || goal.targetDate <= goal.createdAt) return null
  const share = (now - goal.createdAt) / (goal.targetDate - goal.createdAt)
  return Math.max(0, Math.min(1, share))
}

export function sliderStep(target: number): number {
  return Number.isInteger(target) ? 1 : 0.01
}
