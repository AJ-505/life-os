import {
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'

import {
  createProject,
  createTask,
  deleteProject,
  deleteTask,
  fetchBoard,
  moveProject,
  moveTask,
  setProjectStatus,
  setTaskFocus,
  updateProject,
  updateTask,
} from './server'

import type { BoardData, ProjectStatus, Task } from './types'

export const boardQueryOptions = queryOptions({
  queryKey: ['board'],
  queryFn: () => fetchBoard(),
})

type Optimistic<TInput> = (board: BoardData, input: TInput) => BoardData

/**
 * All tracker mutations funnel through here: optional optimistic cache patch,
 * rollback on error, single invalidation on settle.
 */
function useBoardMutation<TInput, TResult>(
  mutationFn: (opts: { data: TInput }) => Promise<TResult>,
  optimistic?: Optimistic<TInput>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: TInput) => mutationFn({ data: input }),
    onMutate: async (input) => {
      if (!optimistic) return {}
      await queryClient.cancelQueries({ queryKey: ['board'] })
      const previous = queryClient.getQueryData<BoardData>(['board'])
      if (previous) {
        queryClient.setQueryData<BoardData>(
          ['board'],
          optimistic(previous, input),
        )
      }
      return { previous }
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['board'], ctx.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['board'] }),
  })
}

const patchTask =
  (id: string, patch: Partial<Task>): Optimistic<unknown> =>
  (board) =>
    board.map((p) => ({
      ...p,
      tasks: p.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }))

export function useCreateProject() {
  return useBoardMutation(createProject)
}

export function useUpdateProject() {
  return useBoardMutation(
    updateProject,
    (board, input: Parameters<typeof updateProject>[0]['data']) =>
      board.map((p) =>
        p.id === input.id
          ? {
              ...p,
              ...(input.name !== undefined && { name: input.name }),
              ...(input.color !== undefined && { color: input.color }),
              ...(input.collapsed !== undefined && {
                collapsed: input.collapsed,
              }),
            }
          : p,
      ),
  )
}

export function useMoveProject() {
  return useBoardMutation(
    moveProject,
    (board, input: { id: string; gridCol: number; gridRow: number }) =>
      board.map((p) =>
        p.id === input.id
          ? { ...p, gridCol: input.gridCol, gridRow: input.gridRow }
          : p,
      ),
  )
}

export function useSetProjectStatus() {
  return useBoardMutation(
    setProjectStatus,
    (board, input: { id: string; status: ProjectStatus }) =>
      board.map((p) => (p.id === input.id ? { ...p, status: input.status } : p)),
  )
}

export function useDeleteProject() {
  return useBoardMutation(deleteProject, (board, input: { id: string }) =>
    board.filter((p) => p.id !== input.id),
  )
}

export function useCreateTask() {
  return useBoardMutation(createTask)
}

export function useUpdateTask() {
  return useBoardMutation(
    updateTask,
    (board, input: Parameters<typeof updateTask>[0]['data']) => {
      const { id, dueAt, ...rest } = input
      return patchTask(id, {
        ...rest,
        ...(dueAt !== undefined && { dueAt: dueAt ? new Date(dueAt) : null }),
        ...(rest.done !== undefined && {
          doneAt: rest.done ? new Date() : null,
        }),
      })(board, input)
    },
  )
}

export function useMoveTask() {
  return useBoardMutation(
    moveTask,
    (board, input: { id: string; projectId: string; position: number }) => {
      const task = board.flatMap((p) => p.tasks).find((t) => t.id === input.id)
      if (!task) return board
      const moved = {
        ...task,
        projectId: input.projectId,
        position: input.position,
      }
      return board.map((p) => {
        const without = p.tasks.filter((t) => t.id !== input.id)
        if (p.id !== input.projectId) return { ...p, tasks: without }
        return {
          ...p,
          tasks: [...without, moved].sort((a, b) => a.position - b.position),
        }
      })
    },
  )
}

export function useSetTaskFocus() {
  return useBoardMutation(
    setTaskFocus,
    (board, input: { id: string; inFocus: boolean; focusOrder?: number }) =>
      patchTask(input.id, {
        inFocus: input.inFocus,
        focusOrder: input.focusOrder ?? 0,
      })(board, input),
  )
}

export function useDeleteTask() {
  return useBoardMutation(deleteTask, (board, input: { id: string }) =>
    board.map((p) => ({
      ...p,
      tasks: p.tasks.filter((t) => t.id !== input.id),
    })),
  )
}
