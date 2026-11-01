import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'

import { api } from '../../convex/_generated/api'
import { descendantIds } from './board/board-logic'
import { useBoardScope } from './board-scope'
import { NO_PROJECT_ID } from './types'

import type { FunctionArgs } from 'convex/server'
import type { OptimisticLocalStore } from 'convex/browser'
import type { BoardData, Project, ProjectWithTasks, Task } from './types'

export type CreateProjectArgs = FunctionArgs<typeof api.tracker.createProject>
export type CreateTaskArgs = FunctionArgs<typeof api.tracker.createTask>

export function boardQueryOptions(spaceId: string | null) {
  return convexQuery(api.tracker.getBoard, { spaceId })
}

export function taskHistoryQueryOptions(taskId: string | null) {
  return convexQuery(api.tracker.getTaskHistory, taskId ? { taskId } : 'skip')
}

function withBoard(
  store: OptimisticLocalStore,
  spaceId: string | null,
  patch: (board: BoardData) => BoardData,
) {
  const board = store.getQuery(api.tracker.getBoard, { spaceId })
  if (!board) return
  store.setQuery(api.tracker.getBoard, { spaceId }, patch(board))
}

const patchTask = (
  board: BoardData,
  id: string,
  patch: Partial<Task>,
): BoardData =>
  board.map((p) =>
    p.tasks.some((t) => t.id === id)
      ? {
          ...p,
          tasks: p.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        }
      : p,
  )

const patchProject = (
  board: BoardData,
  id: string,
  patch: Partial<Project>,
): BoardData => board.map((p) => (p.id === id ? { ...p, ...patch } : p))

function noProjectBucket(
  spaceId: string | null,
  tasks: Array<Task>,
): ProjectWithTasks {
  return {
    id: NO_PROJECT_ID,
    name: 'No project',
    color: 'slate',
    status: 'active',
    collapsed: false,
    showDone: false,
    gridCol: -1,
    gridRow: 0,
    targetDate: null,
    createdAt: 0,
    finishedAt: null,
    shelvedAt: null,
    spaceId,
    tasks,
  }
}

export function useCreateProject() {
  const spaceId = useBoardScope()
  const mutationFn = useConvexMutation(
    api.tracker.createProject,
  ).withOptimisticUpdate((store, args) => {
    withBoard(store, spaceId, (board) => [
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
        spaceId: args.spaceId ?? null,
        tasks: [],
      },
    ])
  })
  return useMutation({ mutationFn })
}

export function useUpdateProject() {
  const spaceId = useBoardScope()
  const mutationFn = useConvexMutation(
    api.tracker.updateProject,
  ).withOptimisticUpdate((store, args) => {
    const { id, ...rest } = args
    withBoard(store, spaceId, (board) => patchProject(board, id, rest))
  })
  return useMutation({ mutationFn })
}

export function useMoveProject() {
  const spaceId = useBoardScope()
  const mutationFn = useConvexMutation(
    api.tracker.moveProject,
  ).withOptimisticUpdate((store, args) => {
    withBoard(store, spaceId, (board) =>
      patchProject(board, args.id, {
        gridCol: args.gridCol,
        gridRow: args.gridRow,
      }),
    )
  })
  return useMutation({ mutationFn })
}

export function useSetProjectStatus() {
  const spaceId = useBoardScope()
  const mutationFn = useConvexMutation(
    api.tracker.setProjectStatus,
  ).withOptimisticUpdate((store, args) => {
    const now = Date.now()
    withBoard(store, spaceId, (board) =>
      patchProject(board, args.id, {
        status: args.status,
        finishedAt: args.status === 'done' ? now : null,
        shelvedAt: args.status === 'shelved' ? now : null,
      }),
    )
  })
  return useMutation({ mutationFn })
}

export function useDeleteProject() {
  const spaceId = useBoardScope()
  const mutationFn = useConvexMutation(
    api.tracker.deleteProject,
  ).withOptimisticUpdate((store, args) => {
    withBoard(store, spaceId, (board) => board.filter((p) => p.id !== args.id))
  })
  return useMutation({ mutationFn })
}

export function useCreateTask() {
  const spaceId = useBoardScope()
  const mutationFn = useConvexMutation(
    api.tracker.createTask,
  ).withOptimisticUpdate((store, args) => {
    withBoard(store, spaceId, (board) => {
      const projectId = args.projectId ?? NO_PROJECT_ID
      const newTask = (taskSpaceId: string | null) => ({
        id: args.id,
        projectId,
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
        assigneeId: args.assigneeId ?? null,
        spaceId: taskSpaceId,
      })
      const target = board.find((p) => p.id === projectId)
      if (target) {
        return board.map((p) =>
          p.id === target.id
            ? {
                ...p,
                tasks: [...p.tasks, newTask(p.spaceId)].sort(
                  (a, b) => a.position - b.position,
                ),
              }
            : p,
        )
      }
      if (projectId !== NO_PROJECT_ID) return board
      return [...board, noProjectBucket(spaceId, [newTask(spaceId)])]
    })
  })
  const create = useMutation({
    mutationFn,
    onError: (e: unknown, args: CreateTaskArgs) => {
      toast.error('Could not create the task', {
        description: e instanceof Error ? e.message : String(e),
        action: { label: 'Retry', onClick: () => create.mutate(args) },
      })
    },
  })
  return create
}

export function useAddTask() {
  const spaceId = useBoardScope()
  const create = useCreateTask()
  return (args: Omit<CreateTaskArgs, 'spaceId'>) =>
    create.mutate({ ...args, spaceId })
}

export function useUpdateTask() {
  const spaceId = useBoardScope()
  const mutationFn = useConvexMutation(
    api.tracker.updateTask,
  ).withOptimisticUpdate((store, args) => {
    const { id, done, ...rest } = args
    withBoard(store, spaceId, (board) => {
      const current = board.flatMap((p) => p.tasks).find((t) => t.id === id)
      return patchTask(board, id, {
        ...rest,
        ...(done !== undefined && {
          done,
          doneAt: done ? Date.now() : (current?.doneAt ?? null),
        }),
      })
    })
  })
  return useMutation({ mutationFn })
}

export function useMoveTask() {
  const spaceId = useBoardScope()
  const mutationFn = useConvexMutation(
    api.tracker.moveTask,
  ).withOptimisticUpdate((store, args) => {
    withBoard(store, spaceId, (board) => {
      const all = board.flatMap((p) => p.tasks)
      if (!all.some((t) => t.id === args.id)) return board
      const movingIds = new Set([args.id, ...descendantIds(all, args.id)])
      const subtree = all
        .filter((t) => movingIds.has(t.id))
        .map((t) =>
          t.id === args.id
            ? { ...t, projectId: args.projectId, position: args.position }
            : { ...t, projectId: args.projectId },
        )
      const next = board.map((p) => {
        const has = p.tasks.some((t) => movingIds.has(t.id))
        const gets = p.id === args.projectId
        if (!has && !gets) return p
        const without = p.tasks.filter((t) => !movingIds.has(t.id))
        if (!gets) return { ...p, tasks: without }
        return {
          ...p,
          tasks: [...without, ...subtree].sort(
            (a, b) => a.position - b.position,
          ),
        }
      })
      if (next.some((p) => p.id === args.projectId)) return next
      if (args.projectId !== NO_PROJECT_ID) return next
      return [...next, noProjectBucket(spaceId, subtree)]
    })
  })
  return useMutation({ mutationFn })
}

export function useSetTaskFocus() {
  const spaceId = useBoardScope()
  const mutationFn = useConvexMutation(
    api.tracker.setTaskFocus,
  ).withOptimisticUpdate((store, args) => {
    withBoard(store, spaceId, (board) =>
      patchTask(board, args.id, {
        inFocus: args.inFocus,
        focusOrder: args.focusOrder ?? 0,
      }),
    )
  })
  return useMutation({ mutationFn })
}

export function useDeleteTask() {
  const spaceId = useBoardScope()
  const mutationFn = useConvexMutation(
    api.tracker.deleteTask,
  ).withOptimisticUpdate((store, args) => {
    withBoard(store, spaceId, (board) => {
      const all = board.flatMap((p) => p.tasks)
      const gone = new Set([args.id, ...descendantIds(all, args.id)])
      return board.map((p) =>
        p.tasks.some((t) => gone.has(t.id))
          ? { ...p, tasks: p.tasks.filter((t) => !gone.has(t.id)) }
          : p,
      )
    })
  })
  return useMutation({ mutationFn })
}
