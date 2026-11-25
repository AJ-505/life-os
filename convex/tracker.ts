import { v } from 'convex/values'

import { internalMutation, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import {
  boardRows,
  getWritable,
  idTakenInScope,
  requireMember,
  requireScope,
  requireUserId,
} from './access'
import {
  afterTaskWrite,
  afterTasksDeleted,
  readUserSettings,
} from './calendarSync'
import { repeatRule } from './recurrence'
import {
  applyTaskUpdate,
  descendants,
  newTask,
  noProjectBucket,
  projectStatus,
  shapeProject,
  shapeTask,
  storedProjectId,
  taskPatchRow,
  taskRow,
} from './taskModel'
import { usableTimeZone } from './zonedTime'

import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Scope } from './access'
import type { ActivityKind, TaskUpdate } from './taskModel'

const DELETE_BATCH = 200
const STALE_CALENDAR_TASK_MS = 7 * 24 * 60 * 60 * 1000
const STALE_ROOTS_PER_PASS = 50

type ActivityTask = { id: string; projectId: string | null; spaceId: Scope }

async function recordActivity(
  ctx: MutationCtx,
  task: ActivityTask,
  actorId: string,
  kind: ActivityKind,
  options: {
    fromUserId?: string | null
    toUserId?: string | null
    detail?: string
  } = {},
) {
  if (!task.spaceId) return
  await ctx.db.insert('taskActivity', {
    spaceId: task.spaceId,
    taskId: task.id,
    projectId: task.projectId,
    actorId,
    kind,
    ...(options.fromUserId !== undefined && { fromUserId: options.fromUserId }),
    ...(options.toUserId !== undefined && { toUserId: options.toUserId }),
    ...(options.detail && { detail: options.detail }),
    createdAt: Date.now(),
  })
}

async function recordUpdateActivity(
  ctx: MutationCtx,
  actorId: string,
  task: Doc<'tasks'>,
  update: TaskUpdate,
) {
  const subject = {
    id: task.id,
    projectId: task.projectId,
    spaceId: task.spaceId ?? null,
  }
  const assignee = update.assigneeId
  if (assignee !== undefined && assignee !== (task.assigneeId ?? null))
    await recordActivity(
      ctx,
      subject,
      actorId,
      assignee === null ? 'unassigned' : 'assigned',
      { fromUserId: task.assigneeId ?? null, toUserId: assignee },
    )
  if (update.done !== undefined && update.done !== task.done)
    await recordActivity(
      ctx,
      subject,
      actorId,
      update.done ? 'completed' : 'reopened',
    )
  if (update.archived !== undefined && update.archived !== task.archived)
    await recordActivity(
      ctx,
      subject,
      actorId,
      update.archived ? 'archived' : 'unarchived',
    )
  const detailsChanged =
    (update.title !== undefined && update.title.trim() !== task.title) ||
    (update.notes !== undefined && update.notes !== task.notes) ||
    (update.dueAt !== undefined && update.dueAt !== task.dueAt) ||
    (update.repeat !== undefined && update.repeat !== (task.repeat ?? null))
  if (detailsChanged)
    await recordActivity(ctx, subject, actorId, 'updated', {
      detail: 'Task details updated',
    })
}

async function profileName(ctx: QueryCtx, userId: string): Promise<string> {
  const profile = await ctx.db
    .query('userProfiles')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first()
  return profile?.displayName?.trim() || 'Member'
}

export const getBoard = query({
  args: {
    spaceId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const spaceId = args.spaceId ?? null
    await requireScope(ctx, userId, spaceId)
    const [projects, tasks] = await Promise.all([
      boardRows(ctx, userId, 'projects', spaceId),
      boardRows(ctx, userId, 'tasks', spaceId),
    ])

    const tasksByProject = new Map<string | null, Array<Doc<'tasks'>>>()
    for (const task of tasks) {
      const list = tasksByProject.get(task.projectId)
      if (list) list.push(task)
      else tasksByProject.set(task.projectId, [task])
    }
    const ordered = (list: Array<Doc<'tasks'>> | undefined) =>
      (list ?? []).sort((a, b) => a.position - b.position).map(shapeTask)

    const board = projects
      .sort((a, b) => a.gridCol - b.gridCol || a.gridRow - b.gridRow)
      .map((p) => ({
        ...shapeProject(p),
        tasks: ordered(tasksByProject.get(p.id)),
      }))
    const loose = tasksByProject.get(null)
    if (!loose) return board
    return [...board, noProjectBucket(spaceId, ordered(loose))]
  },
})

export const getTaskHistory = query({
  args: { taskId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const task = await getWritable(ctx, userId, 'tasks', args.taskId)
    const spaceId = task.spaceId
    if (!spaceId) return []
    const events = await ctx.db
      .query('taskActivity')
      .withIndex('by_space_task', (q) =>
        q.eq('spaceId', spaceId).eq('taskId', task.id),
      )
      .order('desc')
      .take(100)
    return await Promise.all(
      events.map(async (event) => ({
        id: event._id,
        kind: event.kind,
        actorName: await profileName(ctx, event.actorId),
        fromName: event.fromUserId
          ? await profileName(ctx, event.fromUserId)
          : null,
        toName: event.toUserId ? await profileName(ctx, event.toUserId) : null,
        detail: event.detail ?? null,
        createdAt: event.createdAt,
      })),
    )
  },
})

export const createProject = mutation({
  args: {
    id: v.string(),
    name: v.string(),
    color: v.string(),
    gridCol: v.number(),
    gridRow: v.number(),
    spaceId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const name = args.name.trim()
    if (!name) throw new Error('Project name is required')
    const spaceId = args.spaceId ?? null
    await requireScope(ctx, userId, spaceId)
    if (await idTakenInScope(ctx, userId, 'projects', args.id, spaceId)) return
    await ctx.db.insert('projects', {
      userId,
      id: args.id,
      name,
      color: args.color,
      status: 'active',
      collapsed: false,
      gridCol: args.gridCol,
      gridRow: args.gridRow,
      targetDate: null,
      createdAt: Date.now(),
      finishedAt: null,
      shelvedAt: null,
      spaceId,
    })
  },
})

export const updateProject = mutation({
  args: {
    id: v.string(),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    collapsed: v.optional(v.boolean()),
    showDone: v.optional(v.boolean()),
    targetDate: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const project = await getWritable(ctx, userId, 'projects', args.id)
    const { id: _id, ...patch } = args
    await ctx.db.patch(project._id, patch)
  },
})

export const moveProject = mutation({
  args: { id: v.string(), gridCol: v.number(), gridRow: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const project = await getWritable(ctx, userId, 'projects', args.id)
    await ctx.db.patch(project._id, {
      gridCol: args.gridCol,
      gridRow: args.gridRow,
    })
  },
})

export const setProjectStatus = mutation({
  args: { id: v.string(), status: projectStatus },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const project = await getWritable(ctx, userId, 'projects', args.id)
    const now = Date.now()
    await ctx.db.patch(project._id, {
      status: args.status,
      finishedAt: args.status === 'done' ? now : null,
      shelvedAt: args.status === 'shelved' ? now : null,
    })
  },
})

async function projectTasks(
  ctx: MutationCtx,
  userId: string,
  project: { id: string | null; spaceId?: Scope },
): Promise<Array<Doc<'tasks'>>> {
  const spaceId = project.spaceId
  if (spaceId) {
    return await ctx.db
      .query('tasks')
      .withIndex('by_space_project', (q) =>
        q.eq('spaceId', spaceId).eq('projectId', project.id),
      )
      .collect()
  }
  return await ctx.db
    .query('tasks')
    .withIndex('by_user_project', (q) =>
      q.eq('userId', userId).eq('projectId', project.id),
    )
    .collect()
}

const taskToDelete = v.object({ _id: v.id('tasks'), id: v.string() })

type TaskToDelete = { _id: Id<'tasks'>; id: string }

async function deleteTasks(
  ctx: MutationCtx,
  tasks: Array<TaskToDelete>,
  spaceId: Scope,
) {
  const batch = tasks.slice(0, DELETE_BATCH)
  await Promise.all(batch.map((task) => ctx.db.delete(task._id)))
  if (spaceId) {
    const activity = await Promise.all(
      batch.map((task) =>
        ctx.db
          .query('taskActivity')
          .withIndex('by_space_task', (q) =>
            q.eq('spaceId', spaceId).eq('taskId', task.id),
          )
          .collect(),
      ),
    )
    await Promise.all(activity.flat().map((row) => ctx.db.delete(row._id)))
  }
  const rest = tasks.slice(DELETE_BATCH)
  if (rest.length === 0) return
  await ctx.scheduler.runAfter(0, internal.tracker.continueDeleteTasks, {
    tasks: rest.map((task) => ({ _id: task._id, id: task.id })),
    spaceId,
  })
}

export const continueDeleteTasks = internalMutation({
  args: {
    tasks: v.array(taskToDelete),
    spaceId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    await deleteTasks(ctx, args.tasks, args.spaceId ?? null)
  },
})

export const deleteProject = mutation({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const project = await getWritable(ctx, userId, 'projects', args.id)
    const tasks = await projectTasks(ctx, userId, project)
    await afterTasksDeleted(ctx, userId, tasks)
    await deleteTasks(ctx, tasks, project.spaceId ?? null)
    await ctx.db.delete(project._id)
  },
})

async function taskScope(
  ctx: MutationCtx,
  userId: string,
  projectId: string | null,
  looseScope: Scope,
): Promise<Scope> {
  if (projectId === null) {
    await requireScope(ctx, userId, looseScope)
    return looseScope
  }
  const project = await getWritable(ctx, userId, 'projects', projectId)
  return project.spaceId ?? null
}

async function requireAssignable(
  ctx: MutationCtx,
  assigneeId: string | null | undefined,
  spaceId: Scope,
) {
  if (assigneeId == null) return
  if (!spaceId) throw new Error('Tasks on a personal board cannot be assigned')
  await requireMember(ctx, assigneeId, spaceId)
}

export const createTask = mutation({
  args: {
    id: v.string(),
    projectId: v.string(),
    spaceId: v.optional(v.union(v.string(), v.null())),
    parentId: v.optional(v.union(v.string(), v.null())),
    title: v.string(),
    position: v.number(),
    dueAt: v.optional(v.union(v.number(), v.null())),
    durationMinutes: v.optional(v.union(v.number(), v.null())),
    assigneeId: v.optional(v.union(v.string(), v.null())),
    createdFrom: v.optional(v.literal('calendar')),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    if (!args.title.trim()) throw new Error('Task title is required')
    const spaceId = await taskScope(
      ctx,
      userId,
      storedProjectId(args.projectId),
      args.spaceId ?? null,
    )
    await requireAssignable(ctx, args.assigneeId, spaceId)
    const parentId = args.parentId ?? null
    if (parentId !== null) {
      if (parentId === args.id)
        throw new Error('A task cannot be its own subtask')
      const parent = await getWritable(ctx, userId, 'tasks', parentId)
      if ((parent.spaceId ?? null) !== spaceId)
        throw new Error('A subtask must live on the same board as its parent')
    }
    if (await idTakenInScope(ctx, userId, 'tasks', args.id, spaceId)) return

    const task = newTask({ ...args, spaceId }, Date.now())
    const row = {
      ...taskRow(task, userId),
      ...(args.createdFrom && { createdFrom: args.createdFrom }),
    }
    const _id = await ctx.db.insert('tasks', row)
    await afterTaskWrite(ctx, userId, null, {
      ...row,
      _id,
      _creationTime: Date.now(),
    })

    const subject = { id: task.id, projectId: row.projectId, spaceId }
    await recordActivity(ctx, subject, userId, 'created')
    if (task.assigneeId !== null)
      await recordActivity(ctx, subject, userId, 'assigned', {
        toUserId: task.assigneeId,
      })
  },
})

async function repeatZone(
  ctx: MutationCtx,
  userId: string,
  requested: string | undefined,
): Promise<string> {
  const direct = usableTimeZone(requested)
  if (direct) return direct
  const settings = await readUserSettings(ctx, userId)
  return usableTimeZone(settings?.timeZone) ?? 'UTC'
}

export const updateTask = mutation({
  args: {
    id: v.string(),
    title: v.optional(v.string()),
    notes: v.optional(v.union(v.string(), v.null())),
    done: v.optional(v.boolean()),
    archived: v.optional(v.boolean()),
    assigneeId: v.optional(v.union(v.string(), v.null())),
    dueAt: v.optional(v.union(v.number(), v.null())),
    durationMinutes: v.optional(v.union(v.number(), v.null())),
    reminderMinutes: v.optional(v.union(v.number(), v.null())),
    addToCalendar: v.optional(v.boolean()),
    repeat: v.optional(v.union(repeatRule, v.null())),
    timeZone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const task = await getWritable(ctx, userId, 'tasks', args.id)
    const { id: _id, timeZone, ...update } = args
    await requireAssignable(ctx, update.assigneeId, task.spaceId ?? null)

    const clock = {
      now: Date.now(),
      timeZone: update.done ? await repeatZone(ctx, userId, timeZone) : 'UTC',
    }
    const patch = applyTaskUpdate(shapeTask(task), update, clock)
    const row = {
      ...taskPatchRow(patch),
      ...(patch.repeat && { createdFrom: undefined }),
    }
    await ctx.db.patch(task._id, row)
    await afterTaskWrite(ctx, userId, task, { ...task, ...row })
    await recordUpdateActivity(ctx, userId, task, update)
  },
})

export const moveTask = mutation({
  args: { id: v.string(), projectId: v.string(), position: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const task = await getWritable(ctx, userId, 'tasks', args.id)
    const projectId = storedProjectId(args.projectId)
    const source = task.spaceId ?? null
    if ((await taskScope(ctx, userId, projectId, source)) !== source)
      throw new Error('Tasks cannot move between a personal board and a space')

    await ctx.db.patch(task._id, { projectId, position: args.position })
    await recordActivity(
      ctx,
      { id: task.id, projectId, spaceId: source },
      userId,
      'moved',
      {
        detail:
          projectId === null
            ? 'Removed from its project'
            : 'Moved to another project',
      },
    )

    const board = await boardRows(ctx, userId, 'tasks', source)
    await Promise.all(
      descendants(board, task.id).map((child) =>
        ctx.db.patch(child._id, { projectId }),
      ),
    )
  },
})

export const setTaskFocus = mutation({
  args: {
    id: v.string(),
    inFocus: v.boolean(),
    focusOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const task = await getWritable(ctx, userId, 'tasks', args.id)
    if (task.spaceId) throw new Error('Focus is personal only')
    await ctx.db.patch(task._id, {
      inFocus: args.inFocus,
      focusOrder: args.focusOrder ?? 0,
    })
  },
})

export const deleteTask = mutation({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const task = await getWritable(ctx, userId, 'tasks', args.id)
    const spaceId = task.spaceId ?? null
    const board = await boardRows(ctx, userId, 'tasks', spaceId)
    const doomed = [task, ...descendants(board, task.id)]
    await afterTasksDeleted(ctx, userId, doomed)
    await deleteTasks(ctx, doomed, spaceId)
  },
})

function groupBy<T, K>(items: Array<T>, key: (item: T) => K) {
  const groups = new Map<K, Array<T>>()
  for (const item of items) {
    const list = groups.get(key(item))
    if (list) list.push(item)
    else groups.set(key(item), [item])
  }
  return groups
}

export const purgeStaleCalendarTasks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_CALENDAR_TASK_MS
    const stale = await ctx.db
      .query('tasks')
      .withIndex('by_created_from_due', (q) =>
        q.eq('createdFrom', 'calendar').gt('dueAt', 0).lt('dueAt', cutoff),
      )
      .take(STALE_ROOTS_PER_PASS)

    const doomed = new Map<string, Doc<'tasks'>>()
    const boards = new Map<string, Array<Doc<'tasks'>>>()
    for (const root of stale) {
      const key = `${root.spaceId ?? root.userId}:${root.projectId}`
      const board =
        boards.get(key) ??
        (await projectTasks(ctx, root.userId, {
          id: root.projectId,
          spaceId: root.spaceId,
        }))
      boards.set(key, board)
      for (const task of [root, ...descendants(board, root.id)])
        doomed.set(task._id, task)
    }

    const rows = [...doomed.values()]
    for (const [userId, owned] of groupBy(rows, (t) => t.userId))
      await afterTasksDeleted(ctx, userId, owned)
    for (const [spaceId, inSpace] of groupBy(rows, (t) => t.spaceId ?? null))
      await deleteTasks(ctx, inSpace, spaceId)
    if (stale.length === STALE_ROOTS_PER_PASS)
      await ctx.scheduler.runAfter(0, internal.tracker.purgeStaleCalendarTasks)
  },
})
