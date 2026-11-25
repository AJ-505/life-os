import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'

import { api } from '../../convex/_generated/api'
import {
  applyTaskUpdate,
  descendants,
  importedTask,
  newTask,
} from '../../convex/taskModel'
import { localTimeZone } from '../../convex/zonedTime'
import { withTasksIn } from './board/board-logic'
import { useBoardScope } from './board-scope'

import type { FunctionArgs } from 'convex/server'
import type { OptimisticLocalStore } from 'convex/browser'
import type { ExternalEventRow } from '../../convex/calendarPull'
import type { BoardData, Project, Task } from './types'

export type CreateProjectArgs = FunctionArgs<typeof api.tracker.createProject>
export type CreateTaskArgs = FunctionArgs<typeof api.tracker.createTask>
export type UpdateTaskArgs = FunctionArgs<typeof api.tracker.updateTask>

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

const withoutTasks = (board: BoardData, gone: Set<string>): BoardData =>
  board.map((p) =>
    p.tasks.some((t) => gone.has(t.id))
      ? { ...p, tasks: p.tasks.filter((t) => !gone.has(t.id)) }
      : p,
  )

const findTask = (board: BoardData, id: string) =>
  board.flatMap((p) => p.tasks).find((t) => t.id === id)

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

export function useCreateProject() {
  const { spaceId } = useBoardScope()
  const mutationFn = useConvexMutation(
    api.tracker.createProject,
  ).withOptimisticUpdate((store, args) => {
    withBoard(store, spaceId, (board) => [
      ...board,
      {
        id: args.id,
        name: args.name.trim(),
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
  const { spaceId } = useBoardScope()
  const mutationFn = useConvexMutation(
    api.tracker.updateProject,
  ).withOptimisticUpdate((store, args) => {
    const { id, ...rest } = args
    withBoard(store, spaceId, (board) => patchProject(board, id, rest))
  })
  return useMutation({ mutationFn })
}

export function useMoveProject() {
  const { spaceId } = useBoardScope()
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
  const { spaceId } = useBoardScope()
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
  const { spaceId } = useBoardScope()
  const mutationFn = useConvexMutation(
    api.tracker.deleteProject,
  ).withOptimisticUpdate((store, args) => {
    withBoard(store, spaceId, (board) => board.filter((p) => p.id !== args.id))
  })
  return useMutation({ mutationFn })
}

export type AddTaskArgs = Omit<CreateTaskArgs, 'spaceId'>

export function useAddTask() {
  const { spaceId } = useBoardScope()
  const mutationFn = useConvexMutation(
    api.tracker.createTask,
  ).withOptimisticUpdate((store, args) => {
    const task = newTask({ ...args, spaceId }, Date.now())
    withBoard(store, spaceId, (board) =>
      withTasksIn(board, args.projectId, spaceId, [task]),
    )
  })
  const create = useMutation({
    mutationFn,
    onError: (error: unknown, args: CreateTaskArgs) => {
      toast.error('Could not create the task', {
        description: errorText(error),
        action: { label: 'Retry', onClick: () => create.mutate(args) },
      })
    },
  })
  return (args: AddTaskArgs) => create.mutate({ ...args, spaceId })
}

export function useUpdateTask() {
  const { spaceId } = useBoardScope()
  const convexUpdate = useConvexMutation(
    api.tracker.updateTask,
  ).withOptimisticUpdate((store, args) => {
    const { id, timeZone, ...update } = args
    const clock = { now: Date.now(), timeZone: timeZone ?? localTimeZone() }
    withBoard(store, spaceId, (board) => {
      const current = findTask(board, id)
      if (!current) return board
      return patchTask(board, id, applyTaskUpdate(current, update, clock))
    })
  })
  const mutationFn = (args: UpdateTaskArgs) =>
    convexUpdate({ ...args, timeZone: localTimeZone() })
  return useMutation({
    mutationFn,
    onError: (error: unknown) => {
      toast.error('Could not save the task', { description: errorText(error) })
    },
  })
}

export function useMoveTask() {
  const { spaceId } = useBoardScope()
  const mutationFn = useConvexMutation(
    api.tracker.moveTask,
  ).withOptimisticUpdate((store, args) => {
    withBoard(store, spaceId, (board) => {
      const all = board.flatMap((p) => p.tasks)
      const moving = all.find((t) => t.id === args.id)
      if (!moving) return board
      const subtree = [moving, ...descendants(all, args.id)]
      const moved = subtree.map((t) =>
        t.id === args.id
          ? { ...t, projectId: args.projectId, position: args.position }
          : { ...t, projectId: args.projectId },
      )
      const without = withoutTasks(board, new Set(subtree.map((t) => t.id)))
      return withTasksIn(without, args.projectId, spaceId, moved)
    })
  })
  return useMutation({ mutationFn })
}

export function useSetTaskFocus() {
  const { spaceId } = useBoardScope()
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
  const { spaceId } = useBoardScope()
  const mutationFn = useConvexMutation(
    api.tracker.deleteTask,
  ).withOptimisticUpdate((store, args) => {
    withBoard(store, spaceId, (board) => {
      const all = board.flatMap((p) => p.tasks)
      const gone = new Set([
        args.id,
        ...descendants(all, args.id).map((t) => t.id),
      ])
      return withoutTasks(board, gone)
    })
  })
  return useMutation({ mutationFn })
}

export type ImportTarget = {
  event: ExternalEventRow
  taskId: string
  projectId: string
  position: number
}

export function useImportEvent() {
  const mutationFn = useConvexMutation(
    api.calendarPull.importEvent,
  ).withOptimisticUpdate((store, args) => {
    const event = store
      .getAllQueries(api.calendarPull.listExternalEvents)
      .flatMap((entry) => entry.value ?? [])
      .find((candidate) => candidate.eventId === args.eventId)
    if (!event) return
    const task = importedTask(event, args, Date.now())
    withBoard(store, null, (board) =>
      withTasksIn(board, args.projectId, null, [task]),
    )
  })
  const importEvent = useMutation({
    mutationFn,
    onError: (error: unknown) => {
      toast.error('Could not add that event as a task', {
        description: errorText(error),
      })
    },
  })
  return (target: ImportTarget) =>
    importEvent.mutate({
      eventId: target.event.eventId,
      taskId: target.taskId,
      projectId: target.projectId,
      position: target.position,
    })
}
