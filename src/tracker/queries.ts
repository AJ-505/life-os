import { useMutation } from '@tanstack/react-query'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'

import { api } from '../../convex/_generated/api'
import { descendantIds } from './board/board-logic'

import type { OptimisticLocalStore } from 'convex/browser'
import type { BoardData, Project, Task } from './types'

/**
 * The board is one reactive Convex query. Convex server-renders it, then the
 * client resumes a live subscription — no manual refetching, no cache staleness
 * to manage. Writes are Convex mutations with `withOptimisticUpdate`: the patch
 * lands instantly in the local store and Convex reconciles to server truth (and
 * rolls back on error) across every device the user has open.
 */
export const boardQueryOptions = convexQuery(api.tracker.getBoard, {})

/**
 * Every mutation below opened with the same getQuery/guard/setQuery preamble.
 * Collapsing it here also gives the store's board type one home: it used to be
 * ten repeated `as any` casts, and the file carried a `@ts-nocheck` because of
 * the mismatch those were papering over.
 */
function withBoard(
  store: OptimisticLocalStore,
  patch: (board: BoardData) => BoardData,
) {
  const board = store.getQuery(api.tracker.getBoard, {})
  if (!board) return
  store.setQuery(api.tracker.getBoard, {}, patch(board))
}

/* -------------------------------------------------------- optimistic patches
 * Pure helpers over BoardData, reused inside each mutation's optimistic update.
 * Patch one object in place and leave every untouched object's identity alone
 * so the compiler can skip unchanged subtrees. */

const patchTask = (board: BoardData, id: string, patch: Partial<Task>): BoardData =>
  board.map((p) =>
    p.tasks.some((t) => t.id === id)
      ? { ...p, tasks: p.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }
      : p,
  )

const patchProject = (
  board: BoardData,
  id: string,
  patch: Partial<Project>,
): BoardData => board.map((p) => (p.id === id ? { ...p, ...patch } : p))

/* ---------------------------------------------------------------- projects */

export function useCreateProject() {
  const mutationFn = useConvexMutation(api.tracker.createProject).withOptimisticUpdate(
    (store, args) => {
      withBoard(store, (board) => [
        ...board,
        {
          id: args.id,
          name: args.name,
          color: args.color,
          status: 'active',
          collapsed: false,
          showDone: false,
          gridCol: args.gridCol,
          gridRow: args.gridRow,
          targetDate: null,
          createdAt: Date.now(),
          finishedAt: null,
          shelvedAt: null,
          spaceId: null,
          tasks: [],
        },
      ])
    },
  )
  return useMutation({ mutationFn })
}

export function useUpdateProject() {
  const mutationFn = useConvexMutation(api.tracker.updateProject).withOptimisticUpdate(
    (store, args) => {
      const { id, ...rest } = args
      withBoard(store, (board) => patchProject(board, id, rest))
    },
  )
  return useMutation({ mutationFn })
}

export function useMoveProject() {
  const mutationFn = useConvexMutation(api.tracker.moveProject).withOptimisticUpdate(
    (store, args) => {
      withBoard(store, (board) =>
        patchProject(board, args.id, {
          gridCol: args.gridCol,
          gridRow: args.gridRow,
        }),
      )
    },
  )
  return useMutation({ mutationFn })
}

export function useSetProjectStatus() {
  const mutationFn = useConvexMutation(api.tracker.setProjectStatus).withOptimisticUpdate(
    (store, args) => {
      const now = Date.now()
      withBoard(store, (board) =>
        patchProject(board, args.id, {
          status: args.status,
          finishedAt: args.status === 'done' ? now : null,
          shelvedAt: args.status === 'shelved' ? now : null,
        }),
      )
    },
  )
  return useMutation({ mutationFn })
}

export function useDeleteProject() {
  const mutationFn = useConvexMutation(api.tracker.deleteProject).withOptimisticUpdate(
    (store, args) => {
      withBoard(store, (board) => board.filter((p) => p.id !== args.id))
    },
  )
  return useMutation({ mutationFn })
}

/* ------------------------------------------------------------------ tasks */

export function useCreateTask() {
  const mutationFn = useConvexMutation(api.tracker.createTask).withOptimisticUpdate(
    (store, args) => {
      withBoard(store, (board) =>
        board.map((p) =>
          p.id === args.projectId
            ? {
                ...p,
                tasks: [
                  ...p.tasks,
                  {
                    id: args.id,
                    projectId: args.projectId,
                    parentId: args.parentId ?? null,
                    title: args.title,
                    notes: null,
                    position: args.position,
                    done: false,
                    doneAt: null,
                    archived: false,
                    dueAt: args.dueAt ?? null,
                    reminderMinutes: null,
                    addToCalendar: false,
                    calendarEventId: null,
                    inFocus: false,
                    focusOrder: 0,
                    createdAt: Date.now(),
                  },
                ].sort((a, b) => a.position - b.position),
              }
            : p,
        ),
      )
    },
  )
  return useMutation({ mutationFn })
}

export function useUpdateTask() {
  const mutationFn = useConvexMutation(api.tracker.updateTask).withOptimisticUpdate(
    (store, args) => {
      const { id, done, ...rest } = args
      withBoard(store, (board) =>
        patchTask(board, id, {
          ...rest,
          ...(done !== undefined && { done, doneAt: done ? Date.now() : null }),
        }),
      )
    },
  )
  return useMutation({ mutationFn })
}

export function useMoveTask() {
  const mutationFn = useConvexMutation(api.tracker.moveTask).withOptimisticUpdate(
    (store, args) => {
      withBoard(store, (board) => {
        const all = board.flatMap((p) => p.tasks)
        if (!all.some((t) => t.id === args.id)) return board
        // The whole subtree travels with the task.
        const movingIds = new Set([args.id, ...descendantIds(all, args.id)])
        const subtree = all
          .filter((t) => movingIds.has(t.id))
          .map((t) =>
            t.id === args.id
              ? { ...t, projectId: args.projectId, position: args.position }
              : { ...t, projectId: args.projectId },
          )
        return board.map((p) => {
          const has = p.tasks.some((t) => movingIds.has(t.id))
          const gets = p.id === args.projectId
          if (!has && !gets) return p
          const without = p.tasks.filter((t) => !movingIds.has(t.id))
          if (!gets) return { ...p, tasks: without }
          return {
            ...p,
            tasks: [...without, ...subtree].sort((a, b) => a.position - b.position),
          }
        })
      })
    },
  )
  return useMutation({ mutationFn })
}

export function useSetTaskFocus() {
  const mutationFn = useConvexMutation(api.tracker.setTaskFocus).withOptimisticUpdate(
    (store, args) => {
      withBoard(store, (board) =>
        patchTask(board, args.id, {
          inFocus: args.inFocus,
          focusOrder: args.focusOrder ?? 0,
        }),
      )
    },
  )
  return useMutation({ mutationFn })
}

export function useDeleteTask() {
  const mutationFn = useConvexMutation(api.tracker.deleteTask).withOptimisticUpdate(
    (store, args) => {
      withBoard(store, (board) => {
        const all = board.flatMap((p) => p.tasks)
        const gone = new Set([args.id, ...descendantIds(all, args.id)])
        return board.map((p) =>
          p.tasks.some((t) => gone.has(t.id))
            ? { ...p, tasks: p.tasks.filter((t) => !gone.has(t.id)) }
            : p,
        )
      })
    },
  )
  return useMutation({ mutationFn })
}
