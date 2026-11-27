import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'

import { api } from '../../convex/_generated/api'
import {
  goalEdit,
  newGoal,
  progressPatch,
  withCheckin,
} from '../../convex/goalModel'

import type { OptimisticLocalStore } from 'convex/browser'
import type { Goal } from '../../convex/goalModel'

export type { Goal } from '../../convex/goalModel'

export const goalsQueryOptions = convexQuery(api.goals.listGoals, {})

function withGoals(
  store: OptimisticLocalStore,
  patch: (goals: Array<Goal>) => Array<Goal>,
) {
  const goals = store.getQuery(api.goals.listGoals, {})
  if (!goals) return
  store.setQuery(api.goals.listGoals, {}, patch(goals))
}

const patchGoal = (
  goals: Array<Goal>,
  id: string,
  patch: (goal: Goal) => Partial<Goal>,
) => goals.map((goal) => (goal.id === id ? { ...goal, ...patch(goal) } : goal))

const byPosition = (goals: Array<Goal>) =>
  [...goals].sort((a, b) => a.position - b.position)

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const failed = (what: string) => (error: unknown) => {
  toast.error(`Could not ${what}`, { description: errorText(error) })
}

export function useCreateGoal() {
  const mutationFn = useConvexMutation(
    api.goals.createGoal,
  ).withOptimisticUpdate((store, args) => {
    withGoals(store, (goals) => [...goals, newGoal(args, Date.now())])
  })
  return useMutation({ mutationFn, onError: failed('create the goal') })
}

export function useUpdateGoal() {
  const mutationFn = useConvexMutation(
    api.goals.updateGoal,
  ).withOptimisticUpdate((store, args) => {
    const { id, ...edit } = args
    withGoals(store, (goals) =>
      patchGoal(goals, id, (goal) => goalEdit(goal, edit)),
    )
  })
  return useMutation({ mutationFn, onError: failed('save the goal') })
}

export function useSetGoalProgress() {
  const mutationFn = useConvexMutation(
    api.goals.setGoalProgress,
  ).withOptimisticUpdate((store, args) => {
    const now = Date.now()
    withGoals(store, (goals) =>
      patchGoal(goals, args.id, (goal) => {
        const patch = progressPatch(goal, args.value, now)
        return {
          ...patch,
          history: withCheckin(goal.history, patch.current, now),
        }
      }),
    )
  })
  return useMutation({ mutationFn, onError: failed('save your progress') })
}

export function useReopenGoal() {
  const mutationFn = useConvexMutation(
    api.goals.reopenGoal,
  ).withOptimisticUpdate((store, args) => {
    withGoals(store, (goals) =>
      patchGoal(goals, args.id, () => ({ reachedAt: null })),
    )
  })
  return useMutation({ mutationFn, onError: failed('reopen the goal') })
}

export function useMoveGoal() {
  const mutationFn = useConvexMutation(api.goals.moveGoal).withOptimisticUpdate(
    (store, args) => {
      withGoals(store, (goals) =>
        byPosition(
          patchGoal(goals, args.id, () => ({ position: args.position })),
        ),
      )
    },
  )
  return useMutation({ mutationFn, onError: failed('move the goal') })
}

export function useDeleteGoal() {
  const mutationFn = useConvexMutation(
    api.goals.deleteGoal,
  ).withOptimisticUpdate((store, args) => {
    withGoals(store, (goals) => goals.filter((goal) => goal.id !== args.id))
  })
  return useMutation({ mutationFn, onError: failed('delete the goal') })
}
