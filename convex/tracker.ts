import { v } from 'convex/values'

import { internalMutation, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import {
  getMemberSpace,
  requireMember,
  getWritableProject,
  getWritableTask,
  isSpaceMember,
  requireUserId,
  scopeTasks,
  shapeProject,
  shapeTask,
} from './lib'
import { eventIdsForTasks } from './calendar'

import type { Doc } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Scope } from './lib'

type TaskActivityKind =
  | 'created'
  | 'assigned'
  | 'unassigned'
  | 'completed'
  | 'reopened'
  | 'archived'
  | 'unarchived'
  | 'moved'
  | 'updated'

async function recordTaskActivity(
  ctx: MutationCtx,
  task: Pick<Doc<'tasks'>, 'id' | 'projectId' | 'spaceId'>,
  actorId: string,
  kind: TaskActivityKind,
  options?: {
    fromUserId?: string | null
    toUserId?: string | null
    detail?: string
  },
) {
  if (!task.spaceId) return
  await ctx.db.insert('taskActivity', {
    spaceId: task.spaceId,
    taskId: task.id,
    projectId: task.projectId,
    actorId,
    kind,
    ...(options?.fromUserId !== undefined && {
      fromUserId: options.fromUserId,
    }),
    ...(options?.toUserId !== undefined && { toUserId: options.toUserId }),
    ...(options?.detail ? { detail: options.detail } : {}),
    createdAt: Date.now(),
  })
}

async function profileName(
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<string> {
  const profile = await ctx.db
    .query('userProfiles')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first()
  return profile?.displayName?.trim() || 'Member'
}

/** Everything for one board, in one query. Views derive what they need
 *  client-side — exactly like the original `fetchBoard`.
 *
 *  `spaceId: null` is the caller's personal board and excludes every row that
 *  belongs to a space, so a shared project can never leak into a private view.
 *  A space id is membership-checked before anything is read. */
export const getBoard = query({
  args: {
    /**
     * Optional on purpose, and it has to stay that way while one deployment
     * serves production. The deployed front end from before Spaces calls this
     * with no arguments at all, so the absent case is the contract those users
     * are on. Absent means the personal board.
     *
     * `?? null` below is load bearing: Convex hands an omitted optional field
     * to the handler as `undefined`, and the branches compare to `null`, so
     * without the normalization a no-argument call takes the space branch and
     * throws. Tighten this back to required once Vercel points at its own
     * deployment and no old bundle can reach this one.
     */
    spaceId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const spaceId = args.spaceId ?? null

    let projects: Array<Doc<'projects'>>
    if (spaceId === null) {
      const rows = await ctx.db
        .query('projects')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect()
      projects = rows.filter((project) => !project.spaceId)
    } else {
      await getMemberSpace(ctx, userId, spaceId)
      projects = await ctx.db
        .query('projects')
        .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
        .collect()
    }

    const tasks = await scopeTasks(ctx, userId, spaceId)

    const tasksByProject = new Map<string, Array<Doc<'tasks'>>>()
    for (const task of tasks) {
      const list = tasksByProject.get(task.projectId) ?? []
      list.push(task)
      tasksByProject.set(task.projectId, list)
    }

    return projects
      .slice()
      .sort((a, b) => a.gridCol - b.gridCol || a.gridRow - b.gridRow)
      .map((p) => ({
        ...shapeProject(p),
        tasks: (tasksByProject.get(p.id) ?? [])
          .sort((a, b) => a.position - b.position)
          .map(shapeTask),
      }))
  },
})

export const getTaskHistory = query({
  args: { taskId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const task = await getWritableTask(ctx, userId, args.taskId)
    if (!task.spaceId) return []
    const events = await ctx.db
      .query('taskActivity')
      .withIndex('by_space_task', (q) =>
        q.eq('spaceId', task.spaceId!).eq('taskId', task.id),
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

/* ------------------------------------------------------------- projects */

/** Reject an id the caller can already reach on a different board, and treat a
 *  repeat on the same board as the optimistic retry it is. Without this a
 *  member could plant a teammate's id inside a shared space and make every
 *  write to that id ambiguous. */
async function assertScopeProjectIdFree(
  ctx: MutationCtx,
  userId: string,
  id: string,
  scope: Scope,
) {
  const candidates = await ctx.db
    .query('projects')
    .withIndex('by_app_id', (q) => q.eq('id', id))
    .collect()
  for (const candidate of candidates) {
    const reachable =
      candidate.userId === userId ||
      (candidate.spaceId !== undefined &&
        (await isSpaceMember(ctx, userId, candidate.spaceId)))
    if (!reachable) continue
    if ((candidate.spaceId ?? null) === scope) return true
    throw new Error('That project id is already used on another of your boards')
  }
  return false
}

export const createProject = mutation({
  args: {
    id: v.string(),
    name: v.string(),
    color: v.string(),
    gridCol: v.number(),
    gridRow: v.number(),
    /** Optional for the same reason as `getBoard`: the deployed front end from
     *  before Spaces sends no `spaceId` at all. Absent means a personal
     *  project. See the note on `getBoard`. */
    spaceId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const name = args.name.trim()
    if (!name) throw new Error('Project name is required')
    const spaceId = args.spaceId ?? null
    if (spaceId !== null) await getMemberSpace(ctx, userId, spaceId)

    // The client supplies the id so creation is optimistic; a duplicate on the
    // same board means an optimistic retry already landed — success, not error.
    if (await assertScopeProjectIdFree(ctx, userId, args.id, spaceId)) return

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
      // Spread the normalized value, so an absent argument never writes an
      // explicit `undefined` onto the row.
      ...(spaceId !== null && { spaceId }),
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
    const project = await getWritableProject(ctx, userId, args.id)
    const { id: _id, ...patch } = args
    await ctx.db.patch(project._id, patch)
  },
})

export const moveProject = mutation({
  args: { id: v.string(), gridCol: v.number(), gridRow: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const project = await getWritableProject(ctx, userId, args.id)
    await ctx.db.patch(project._id, {
      gridCol: args.gridCol,
      gridRow: args.gridRow,
    })
  },
})

export const setProjectStatus = mutation({
  args: {
    id: v.string(),
    status: v.union(
      v.literal('active'),
      v.literal('shelved'),
      v.literal('done'),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const project = await getWritableProject(ctx, userId, args.id)
    const now = Date.now()
    await ctx.db.patch(project._id, {
      status: args.status,
      finishedAt: args.status === 'done' ? now : null,
      shelvedAt: args.status === 'shelved' ? now : null,
    })
  },
})

/** The project-scoped task read, chosen from the project's own scope. A single
 *  `projectId` index would be the same query for every account. */
async function projectTasks(
  ctx: MutationCtx,
  userId: string,
  project: Doc<'projects'>,
): Promise<Array<Doc<'tasks'>>> {
  if (project.spaceId) {
    return await ctx.db
      .query('tasks')
      .withIndex('by_space_project', (q) =>
        q.eq('spaceId', project.spaceId!).eq('projectId', project.id),
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

export const deleteProject = mutation({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const project = await getWritableProject(ctx, userId, args.id)
    // Hard delete cascades to the project's tasks, and to their events.
    const tasks = await projectTasks(ctx, userId, project)
    await scheduleEventCleanup(ctx, userId, tasks)
    await deleteTasksBatched(ctx, tasks)
    await ctx.db.delete(project._id)
  },
})

/* ---------------------------------------------------------------- tasks */

/** Same rule as projects: an id may exist once per board the caller can reach. */
async function assertScopeTaskIdFree(
  ctx: MutationCtx,
  userId: string,
  id: string,
  scope: Scope,
) {
  const candidates = await ctx.db
    .query('tasks')
    .withIndex('by_app_id', (q) => q.eq('id', id))
    .collect()
  for (const candidate of candidates) {
    const reachable =
      candidate.userId === userId ||
      (candidate.spaceId !== undefined &&
        (await isSpaceMember(ctx, userId, candidate.spaceId)))
    if (!reachable) continue
    if ((candidate.spaceId ?? null) === scope) return true
    throw new Error('That task id is already used on another of your boards')
  }
  return false
}

export const createTask = mutation({
  args: {
    id: v.string(),
    projectId: v.string(),
    parentId: v.optional(v.union(v.string(), v.null())),
    title: v.string(),
    position: v.number(),
    dueAt: v.optional(v.union(v.number(), v.null())),
    assigneeId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const title = args.title.trim()
    if (!title) throw new Error('Task title is required')
    // Writing to the destination project is what gates creation.
    const project = await getWritableProject(ctx, userId, args.projectId)
    const assigneeId = args.assigneeId ?? null
    if (assigneeId !== null) {
      if (!project.spaceId)
        throw new Error('Tasks on a personal board cannot be assigned')
      await requireMember(ctx, assigneeId, project.spaceId)
    }
    if (
      await assertScopeTaskIdFree(ctx, userId, args.id, project.spaceId ?? null)
    )
      return
    await ctx.db.insert('tasks', {
      userId,
      id: args.id,
      projectId: args.projectId,
      parentId: args.parentId ?? null,
      title,
      notes: null,
      position: args.position,
      done: false,
      doneAt: null,
      archived: false,
      dueAt: args.dueAt ?? null,
      inFocus: false,
      focusOrder: 0,
      createdAt: Date.now(),
      assigneeId,
      ...(project.spaceId && { spaceId: project.spaceId }),
    })
    const activityTask = {
      id: args.id,
      projectId: project.id,
      spaceId: project.spaceId,
    }
    await recordTaskActivity(ctx, activityTask, userId, 'created')
    if (assigneeId !== null) {
      await recordTaskActivity(ctx, activityTask, userId, 'assigned', {
        toUserId: assigneeId,
      })
    }
  },
})

/** Fields whose change can make the Google event wrong. `done` and `archived`
 *  are here because a finished or shelved task should not keep an event. */
const CALENDAR_FIELDS = [
  'dueAt',
  'reminderMinutes',
  'addToCalendar',
  'done',
  'archived',
  'title',
  'notes',
] as const

/** Schedule the push when the *merged* row either has an event or wants one.
 *  Judging by the loaded row alone would miss the first time a user turns
 *  Add to calendar on, because that row has neither yet. */
async function scheduleCalendarSync(
  ctx: MutationCtx,
  userId: string,
  before: Doc<'tasks'>,
  patch: Partial<Doc<'tasks'>>,
) {
  const touches = CALENDAR_FIELDS.some(
    (field) => patch[field] !== undefined && patch[field] !== before[field],
  )
  if (!touches) return
  const merged = { ...before, ...patch }
  const wants =
    merged.addToCalendar === true &&
    merged.dueAt !== null &&
    !merged.done &&
    !merged.archived
  const has = (merged.calendarEventId ?? null) !== null
  if (!wants && !has) return
  await ctx.scheduler.runAfter(0, internal.calendar.syncTaskForUser, {
    userId,
    taskId: merged.id,
  })
}

/** Best-effort event deletion for rows about to disappear. The rule for which
 *  events a personal task owns lives in one place (see `eventIdsForTasks`). */
async function scheduleEventCleanup(
  ctx: MutationCtx,
  userId: string,
  tasks: Array<Doc<'tasks'>>,
) {
  const eventIds = eventIdsForTasks(tasks)
  if (eventIds.length === 0) return
  await ctx.scheduler.runAfter(0, internal.calendar.deleteEventsForUser, {
    userId,
    eventIds,
  })
}

/** Index a set of tasks by their parent, for the subtree walks. */
function childrenByParent(tasks: Array<Doc<'tasks'>>) {
  const childrenOf = new Map<string, Array<Doc<'tasks'>>>()
  for (const task of tasks) {
    if (!task.parentId) continue
    const list = childrenOf.get(task.parentId) ?? []
    list.push(task)
    childrenOf.set(task.parentId, list)
  }
  return childrenOf
}

/** Everything below `root`, inclusive, walked over one board's tasks. */
function withDescendants(
  tasks: Array<Doc<'tasks'>>,
  root: Doc<'tasks'>,
): Array<Doc<'tasks'>> {
  const childrenOf = childrenByParent(tasks)
  const found = [root]
  const queue = [...(childrenOf.get(root.id) ?? [])]
  while (queue.length > 0) {
    const child = queue.shift()!
    found.push(child)
    queue.push(...(childrenOf.get(child.id) ?? []))
  }
  return found
}

/** Convex bounds one transaction, so a delete that could outgrow it hands the
 *  rest to a scheduled continuation instead of failing whole and leaving the
 *  space half-removed. */
const DELETE_BATCH = 200

export const continueDeleteTasks = internalMutation({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, args) => {
    const batch = args.ids.slice(0, DELETE_BATCH)
    await Promise.all(
      batch.map((id) => ctx.db.delete(id as Doc<'tasks'>['_id'])),
    )
    if (args.ids.length > batch.length) {
      await ctx.scheduler.runAfter(0, internal.tracker.continueDeleteTasks, {
        ids: args.ids.slice(batch.length),
      })
    }
  },
})

async function deleteTasksBatched(
  ctx: MutationCtx,
  tasks: Array<Doc<'tasks'>>,
) {
  const ids = tasks.map((task) => task._id)
  const batch = ids.slice(0, DELETE_BATCH)
  await Promise.all(batch.map((id) => ctx.db.delete(id)))
  if (ids.length > batch.length) {
    await ctx.scheduler.runAfter(0, internal.tracker.continueDeleteTasks, {
      ids: ids.slice(batch.length),
    })
  }
}

/** `doneAt` is derived from `done` rather than accepted as an argument, so the
 *  two can never disagree. */
export const updateTask = mutation({
  args: {
    id: v.string(),
    title: v.optional(v.string()),
    notes: v.optional(v.union(v.string(), v.null())),
    done: v.optional(v.boolean()),
    archived: v.optional(v.boolean()),
    assigneeId: v.optional(v.union(v.string(), v.null())),
    dueAt: v.optional(v.union(v.number(), v.null())),
    reminderMinutes: v.optional(v.union(v.number(), v.null())),
    addToCalendar: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const task = await getWritableTask(ctx, userId, args.id)
    const { id: _id, done, assigneeId, ...rest } = args
    if (assigneeId !== undefined && assigneeId !== null) {
      if (!task.spaceId)
        throw new Error('Tasks on a personal board cannot be assigned')
      await requireMember(ctx, assigneeId, task.spaceId)
    }
    const patch: Partial<Doc<'tasks'>> = { ...rest }
    if (assigneeId !== undefined) patch.assigneeId = assigneeId
    if (done !== undefined) {
      patch.done = done
      patch.doneAt = done ? Date.now() : null
    }
    await ctx.db.patch(task._id, patch)
    await scheduleCalendarSync(ctx, userId, task, patch)
    if (task.spaceId) {
      const activityTask = {
        id: task.id,
        projectId: task.projectId,
        spaceId: task.spaceId,
      }
      if (
        assigneeId !== undefined &&
        assigneeId !== (task.assigneeId ?? null)
      ) {
        await recordTaskActivity(
          ctx,
          activityTask,
          userId,
          assigneeId === null ? 'unassigned' : 'assigned',
          {
            fromUserId: task.assigneeId ?? null,
            toUserId: assigneeId,
          },
        )
      }
      if (done !== undefined && done !== task.done) {
        await recordTaskActivity(
          ctx,
          activityTask,
          userId,
          done ? 'completed' : 'reopened',
        )
      }
      if (args.archived !== undefined && args.archived !== task.archived) {
        await recordTaskActivity(
          ctx,
          activityTask,
          userId,
          args.archived ? 'archived' : 'unarchived',
        )
      }
      if (
        (args.title !== undefined && args.title.trim() !== task.title) ||
        (args.notes !== undefined && args.notes !== task.notes) ||
        (args.dueAt !== undefined && args.dueAt !== task.dueAt)
      ) {
        await recordTaskActivity(ctx, activityTask, userId, 'updated', {
          detail: 'Task details updated',
        })
      }
    }
  },
})

/** Move within a project or across projects of the same board. Focus
 *  membership is untouched. Subtasks travel with their parent. */
export const moveTask = mutation({
  args: { id: v.string(), projectId: v.string(), position: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const task = await getWritableTask(ctx, userId, args.id)
    const destination = await getWritableProject(ctx, userId, args.projectId)
    const source = task.spaceId ?? null
    if ((destination.spaceId ?? null) !== source)
      throw new Error('Tasks cannot move between a personal board and a space')

    await ctx.db.patch(task._id, {
      projectId: args.projectId,
      position: args.position,
    })
    if (source) {
      await recordTaskActivity(
        ctx,
        { id: task.id, projectId: args.projectId, spaceId: source },
        userId,
        'moved',
        { detail: 'Moved to another project' },
      )
    }

    // The whole subtree travels with the task, walked over the board's own
    // tasks rather than the caller's: in a space a teammate may have created
    // the children, and a caller-scoped walk would leave them behind.
    const boardTasks = await scopeTasks(ctx, userId, source)
    const childrenOf = childrenByParent(boardTasks)
    const queue = [...(childrenOf.get(args.id) ?? [])]
    while (queue.length > 0) {
      const child = queue.shift()!
      await ctx.db.patch(child._id, { projectId: args.projectId })
      queue.push(...(childrenOf.get(child.id) ?? []))
    }
  },
})

/**
 * Focus is a clone-by-reference: toggling it on makes the task appear in the
 * Focus panel while it keeps living inside its project.
 *
 * Refused in a space: `inFocus` is one boolean on a row every member reads, so
 * sharing a board would share everyone's working set. The per-user model is a
 * separate feature.
 */
export const setTaskFocus = mutation({
  args: {
    id: v.string(),
    inFocus: v.boolean(),
    focusOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const task = await getWritableTask(ctx, userId, args.id)
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
    const task = await getWritableTask(ctx, userId, args.id)
    // Cascade to the subtree, walked over the board's own tasks.
    const boardTasks = await scopeTasks(ctx, userId, task.spaceId ?? null)
    const toDelete = withDescendants(boardTasks, task)
    await scheduleEventCleanup(ctx, userId, toDelete)
    await deleteTasksBatched(ctx, toDelete)
  },
})
