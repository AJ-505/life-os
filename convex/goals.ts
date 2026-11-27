import { v } from 'convex/values'

import { internalMutation, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { requireUserId } from './access'
import {
  HISTORY_POINTS,
  changesProgress,
  goalEdit,
  mergesWithLast,
  newGoal,
  progressPatch,
  shapeGoal,
} from './goalModel'

import type { Infer } from 'convex/values'
import type { Doc } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Goal } from './goalModel'

const MAX_GOALS = 500
const DELETE_BATCH = 500

async function findGoal(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  id: string,
): Promise<Doc<'goals'> | null> {
  return await ctx.db
    .query('goals')
    .withIndex('by_user_id', (q) => q.eq('userId', userId).eq('id', id))
    .unique()
}

async function requireGoal(ctx: MutationCtx, userId: string, id: string) {
  const goal = await findGoal(ctx, userId, id)
  if (!goal) throw new Error('Goal not found')
  return goal
}

function checkins(ctx: QueryCtx | MutationCtx, userId: string, goalId: string) {
  return ctx.db
    .query('goalCheckins')
    .withIndex('by_user_goal_at', (q) =>
      q.eq('userId', userId).eq('goalId', goalId),
    )
}

async function recordCheckin(
  ctx: MutationCtx,
  userId: string,
  goalId: string,
  value: number,
  now: number,
) {
  const newest = await checkins(ctx, userId, goalId).order('desc').take(2)
  if (mergesWithLast(newest, now)) {
    await ctx.db.patch(newest[0]._id, { value, at: now })
    return
  }
  await ctx.db.insert('goalCheckins', { userId, goalId, value, at: now })
}

export const listGoals = query({
  args: {},
  handler: async (ctx): Promise<Array<Goal>> => {
    const userId = await requireUserId(ctx)
    const goals = await exportGoals(ctx, userId)
    return goals.sort((a, b) => a.position - b.position)
  },
})

const optionalUnit = v.union(v.string(), v.null())
const optionalDate = v.union(v.number(), v.null())

export const createGoal = mutation({
  args: {
    id: v.string(),
    title: v.string(),
    color: v.string(),
    target: v.number(),
    unit: optionalUnit,
    targetDate: optionalDate,
    position: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    if (await findGoal(ctx, userId, args.id)) return
    const { history, ...goal } = newGoal(args, Date.now())
    await ctx.db.insert('goals', { userId, ...goal })
    for (const point of history)
      await ctx.db.insert('goalCheckins', { userId, goalId: goal.id, ...point })
  },
})

export const updateGoal = mutation({
  args: {
    id: v.string(),
    title: v.optional(v.string()),
    color: v.optional(v.string()),
    target: v.optional(v.number()),
    unit: v.optional(optionalUnit),
    targetDate: v.optional(optionalDate),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const goal = await requireGoal(ctx, userId, args.id)
    const { id: _id, ...edit } = args
    await ctx.db.patch(goal._id, {
      ...goalEdit(goal, edit),
      updatedAt: Date.now(),
    })
  },
})

export const setGoalProgress = mutation({
  args: { id: v.string(), value: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const goal = await requireGoal(ctx, userId, args.id)
    if (!changesProgress(goal, args.value)) return
    const now = Date.now()
    const patch = progressPatch(goal, args.value, now)
    await ctx.db.patch(goal._id, patch)
    await recordCheckin(ctx, userId, goal.id, patch.current, now)
  },
})

export const reopenGoal = mutation({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const goal = await requireGoal(ctx, userId, args.id)
    await ctx.db.patch(goal._id, { reachedAt: null, updatedAt: Date.now() })
  },
})

export const moveGoal = mutation({
  args: { id: v.string(), position: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const goal = await requireGoal(ctx, userId, args.id)
    await ctx.db.patch(goal._id, { position: args.position })
  },
})

async function deleteCheckins(
  ctx: MutationCtx,
  userId: string,
  goalId: string,
) {
  const batch = await checkins(ctx, userId, goalId).take(DELETE_BATCH)
  await Promise.all(batch.map((point) => ctx.db.delete(point._id)))
  if (batch.length < DELETE_BATCH) return
  await ctx.scheduler.runAfter(0, internal.goals.continueDeleteCheckins, {
    userId,
    goalId,
  })
}

export const continueDeleteCheckins = internalMutation({
  args: { userId: v.string(), goalId: v.string() },
  handler: async (ctx, args) => {
    await deleteCheckins(ctx, args.userId, args.goalId)
  },
})

export const deleteGoal = mutation({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const goal = await findGoal(ctx, userId, args.id)
    if (!goal) return
    await ctx.db.delete(goal._id)
    await deleteCheckins(ctx, userId, goal.id)
  },
})

export const backupGoal = v.object({
  id: v.string(),
  title: v.string(),
  color: v.string(),
  target: v.number(),
  unit: v.union(v.string(), v.null()),
  targetDate: v.union(v.number(), v.null()),
  current: v.number(),
  position: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  reachedAt: v.union(v.number(), v.null()),
  history: v.array(v.object({ value: v.number(), at: v.number() })),
})

export async function exportGoals(ctx: QueryCtx, userId: string) {
  const goals = await ctx.db
    .query('goals')
    .withIndex('by_user_id', (q) => q.eq('userId', userId))
    .take(MAX_GOALS)
  return await Promise.all(
    goals.map(async (goal) => {
      const recent = await checkins(ctx, userId, goal.id)
        .order('desc')
        .take(HISTORY_POINTS)
      const history = recent
        .reverse()
        .map((point) => ({ value: point.value, at: point.at }))
      return { ...shapeGoal(goal), history }
    }),
  )
}

export async function replaceGoals(
  ctx: MutationCtx,
  userId: string,
  goals: Array<Infer<typeof backupGoal>>,
) {
  const existing = await ctx.db
    .query('goals')
    .withIndex('by_user_id', (q) => q.eq('userId', userId))
    .take(MAX_GOALS)
  const unique = [...new Map(goals.map((goal) => [goal.id, goal])).values()]
  await replaceGoalsStep(ctx, {
    userId,
    staleIds: existing.map((goal) => goal.id),
    goals: unique.slice(0, MAX_GOALS),
  })
}

const IMPORT_GOALS_BATCH = 20

const replaceState = v.object({
  userId: v.string(),
  staleIds: v.array(v.string()),
  goals: v.array(backupGoal),
})

type ReplaceState = Infer<typeof replaceState>

async function removeStaleGoal(ctx: MutationCtx, state: ReplaceState) {
  const [goalId, ...rest] = state.staleIds
  const batch = await checkins(ctx, state.userId, goalId).take(DELETE_BATCH)
  await Promise.all(batch.map((point) => ctx.db.delete(point._id)))
  if (batch.length === DELETE_BATCH) return state
  const goal = await findGoal(ctx, state.userId, goalId)
  if (goal) await ctx.db.delete(goal._id)
  return { ...state, staleIds: rest }
}

async function insertGoals(ctx: MutationCtx, state: ReplaceState) {
  const batch = state.goals.slice(0, IMPORT_GOALS_BATCH)
  for (const { history, ...goal } of batch) {
    await ctx.db.insert('goals', { userId: state.userId, ...goal })
    for (const point of history.slice(-HISTORY_POINTS))
      await ctx.db.insert('goalCheckins', {
        userId: state.userId,
        goalId: goal.id,
        ...point,
      })
  }
  return { ...state, goals: state.goals.slice(IMPORT_GOALS_BATCH) }
}

async function replaceGoalsStep(ctx: MutationCtx, state: ReplaceState) {
  const next =
    state.staleIds.length > 0
      ? await removeStaleGoal(ctx, state)
      : await insertGoals(ctx, state)
  if (next.staleIds.length === 0 && next.goals.length === 0) return
  await ctx.scheduler.runAfter(0, internal.goals.continueReplaceGoals, {
    state: next,
  })
}

export const continueReplaceGoals = internalMutation({
  args: { state: replaceState },
  handler: async (ctx, args) => {
    await replaceGoalsStep(ctx, args.state)
  },
})
