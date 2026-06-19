import {
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'

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

import { descendantIds } from './board/board-logic'

import type { QueryClient } from '@tanstack/react-query'
import type { BoardData, ProjectStatus, Task } from './types'

export const boardQueryOptions = queryOptions({
  queryKey: ['board'],
  queryFn: () => fetchBoard(),
  // The cache is the in-session source of truth. We never want a background
  // refetch racing an optimistic write, so refetches are explicit only.
  staleTime: Infinity,
  gcTime: Infinity,
})

/* ------------------------------------------------------------------ outbox
 * Writes never block the UI and never roll back. If the server rejects or
 * the network drops, the optimistic state stays exactly as the user left it
 * and the write goes into this in-memory outbox, which keeps retrying (in
 * order) until everything lands. The board only refetches once fully synced.
 */

type OutboxEntry = { run: () => Promise<unknown> }

const outbox: Array<OutboxEntry> = []
let draining = false
let retryTimer: ReturnType<typeof setTimeout> | null = null
let failureToastShown = false

function scheduleDrain(queryClient: QueryClient, delayMs: number) {
  if (retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    void drainOutbox(queryClient)
  }, delayMs)
}

async function drainOutbox(queryClient: QueryClient) {
  if (draining || outbox.length === 0) return
  draining = true
  try {
    // Sequential and in order: a create must land before its update/delete.
    while (outbox.length > 0) {
      await outbox[0].run()
      outbox.shift()
    }
    if (failureToastShown) {
      failureToastShown = false
      toast.success('All changes saved.')
    }
    await queryClient.invalidateQueries({ queryKey: ['board'] })
  } catch {
    if (!failureToastShown) {
      failureToastShown = true
      toast.warning("Couldn't reach the server — your changes are kept here and will keep retrying.")
    }
    scheduleDrain(queryClient, 5000)
  } finally {
    draining = false
  }
}

export function pendingWrites(): number {
  return outbox.length
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (outbox.length > 0) e.preventDefault()
  })
}

/* -------------------------------------------------------------- mutations */

type Optimistic<TInput> = (board: BoardData, input: TInput) => BoardData

/**
 * All tracker mutations funnel through here. The optimistic patch is the
 * write; the server call trails behind it. Failures enqueue into the outbox
 * instead of rolling back, and the board only refetches when no writes are
 * in flight (so rapid-fire actions never fight a refetch).
 */
function useBoardMutation<TInput, TResult>(
  mutationFn: (opts: { data: TInput }) => Promise<TResult>,
  optimistic: Optimistic<TInput>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: TInput) => mutationFn({ data: input }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['board'] })
      const previous = queryClient.getQueryData<BoardData>(['board'])
      if (previous) {
        queryClient.setQueryData<BoardData>(
          ['board'],
          optimistic(previous, input),
        )
      }
    },
    onError: (_err, input) => {
      outbox.push({ run: () => mutationFn({ data: input }) })
      scheduleDrain(queryClient, 3000)
    },
    onSuccess: () => {
      // Refetch only once the dust settles: last in-flight mutation, nothing
      // queued. Keeps server truth (timestamps etc.) without mid-drag churn.
      if (queryClient.isMutating() <= 1 && outbox.length === 0) {
        void queryClient.invalidateQueries({ queryKey: ['board'] })
      }
    },
  })
}

/** Patch one task in place, leaving every untouched object's identity alone
 *  so memoized cards skip re-rendering. */
const patchTask =
  (id: string, patch: Partial<Task>): Optimistic<unknown> =>
  (board) =>
    board.map((p) =>
      p.tasks.some((t) => t.id === id)
        ? {
            ...p,
            tasks: p.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
          }
        : p,
    )

const patchProject =
  (id: string, patch: Partial<BoardData[number]>): Optimistic<unknown> =>
  (board) =>
    board.map((p) => (p.id === id ? { ...p, ...patch } : p))

export function useCreateProject() {
  return useBoardMutation(
    createProject,
    (board, input: Parameters<typeof createProject>[0]['data']) => [
      ...board,
      {
        id: input.id,
        name: input.name,
        color: input.color,
        status: 'active' as const,
        collapsed: false,
        gridCol: input.gridCol,
        gridRow: input.gridRow,
        targetDate: null,
        createdAt: new Date(),
        finishedAt: null,
        shelvedAt: null,
        tasks: [],
      },
    ],
  )
}

export function useUpdateProject() {
  return useBoardMutation(
    updateProject,
    (board, input: Parameters<typeof updateProject>[0]['data']) => {
      const { id, targetDate, ...rest } = input
      return patchProject(id, {
        ...rest,
        ...(targetDate !== undefined && {
          targetDate: targetDate ? new Date(targetDate) : null,
        }),
      })(board, input)
    },
  )
}

export function useMoveProject() {
  return useBoardMutation(
    moveProject,
    (board, input: { id: string; gridCol: number; gridRow: number }) =>
      patchProject(input.id, {
        gridCol: input.gridCol,
        gridRow: input.gridRow,
      })(board, input),
  )
}

export function useSetProjectStatus() {
  return useBoardMutation(
    setProjectStatus,
    (board, input: { id: string; status: ProjectStatus }) =>
      patchProject(input.id, {
        status: input.status,
        finishedAt: input.status === 'done' ? new Date() : null,
        shelvedAt: input.status === 'shelved' ? new Date() : null,
      })(board, input),
  )
}

export function useDeleteProject() {
  return useBoardMutation(deleteProject, (board, input: { id: string }) =>
    board.filter((p) => p.id !== input.id),
  )
}

export function useCreateTask() {
  return useBoardMutation(
    createTask,
    (board, input: Parameters<typeof createTask>[0]['data']) =>
      board.map((p) =>
        p.id === input.projectId
          ? {
              ...p,
              tasks: [
                ...p.tasks,
                {
                  id: input.id,
                  projectId: input.projectId,
                  parentId: input.parentId ?? null,
                  title: input.title,
                  notes: null,
                  position: input.position,
                  done: false,
                  doneAt: null,
                  archived: false,
                  dueAt: input.dueAt ? new Date(input.dueAt) : null,
                  inFocus: false,
                  focusOrder: 0,
                  createdAt: new Date(),
                },
              ].sort((a, b) => a.position - b.position),
            }
          : p,
      ),
  )
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
      const all = board.flatMap((p) => p.tasks)
      const task = all.find((t) => t.id === input.id)
      if (!task) return board
      // The whole subtree travels with the task.
      const movingIds = new Set([input.id, ...descendantIds(all, input.id)])
      const subtree = all
        .filter((t) => movingIds.has(t.id))
        .map((t) =>
          t.id === input.id
            ? { ...t, projectId: input.projectId, position: input.position }
            : { ...t, projectId: input.projectId },
        )
      return board.map((p) => {
        const has = p.tasks.some((t) => movingIds.has(t.id))
        const gets = p.id === input.projectId
        if (!has && !gets) return p
        const without = p.tasks.filter((t) => !movingIds.has(t.id))
        if (!gets) return { ...p, tasks: without }
        return {
          ...p,
          tasks: [...without, ...subtree].sort((a, b) => a.position - b.position),
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
  return useBoardMutation(deleteTask, (board, input: { id: string }) => {
    const all = board.flatMap((p) => p.tasks)
    const gone = new Set([input.id, ...descendantIds(all, input.id)])
    return board.map((p) =>
      p.tasks.some((t) => gone.has(t.id))
        ? { ...p, tasks: p.tasks.filter((t) => !gone.has(t.id)) }
        : p,
    )
  })
}
