import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import { getOwnedProject, getOwnedTask, requireUserId } from './lib'

import type { Doc } from './_generated/dataModel'

/* ---------------------------------------------------------------- shaping
 * Return exactly the original Drizzle-era field set so `BoardData` and the
 * whole UI (plus the optimistic updates) stay shape-stable. Convex system
 * fields (`_id`, `_creationTime`) and the private `userId` never leave here.
 */
function shapeProject(p: Doc<'projects'>) {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    status: p.status,
    collapsed: p.collapsed,
    gridCol: p.gridCol,
    gridRow: p.gridRow,
    targetDate: p.targetDate,
    createdAt: p.createdAt,
    finishedAt: p.finishedAt,
    shelvedAt: p.shelvedAt,
  }
}

function shapeTask(t: Doc<'tasks'>) {
  return {
    id: t.id,
    projectId: t.projectId,
    parentId: t.parentId,
    title: t.title,
    notes: t.notes,
    position: t.position,
    done: t.done,
    doneAt: t.doneAt,
    archived: t.archived,
    dueAt: t.dueAt,
    inFocus: t.inFocus,
    focusOrder: t.focusOrder,
    createdAt: t.createdAt,
  }
}

/** Everything for the signed-in user, in one query. Views derive what they
 *  need client-side — exactly like the original `fetchBoard`. */
export const getBoard = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx)
    const [projects, tasks] = await Promise.all([
      ctx.db
        .query('projects')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect(),
      ctx.db
        .query('tasks')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect(),
    ])

    const tasksByProject = new Map<string, Array<Doc<'tasks'>>>()
    for (const t of tasks) {
      const list = tasksByProject.get(t.projectId) ?? []
      list.push(t)
      tasksByProject.set(t.projectId, list)
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

/* ------------------------------------------------------------- projects */

export const createProject = mutation({
  args: {
    id: v.string(),
    name: v.string(),
    color: v.string(),
    gridCol: v.number(),
    gridRow: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const name = args.name.trim()
    if (!name) throw new Error('Project name is required')
    // Client supplies the id so creation is optimistic; a duplicate means an
    // optimistic retry already landed — treat as success, not an error.
    const existing = await ctx.db
      .query('projects')
      .withIndex('by_user_id', (q) => q.eq('userId', userId).eq('id', args.id))
      .unique()
    if (existing) return
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
    })
  },
})

export const updateProject = mutation({
  args: {
    id: v.string(),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    collapsed: v.optional(v.boolean()),
    targetDate: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const project = await getOwnedProject(ctx, userId, args.id)
    const { id: _id, ...patch } = args
    await ctx.db.patch(project._id, patch)
  },
})

export const moveProject = mutation({
  args: { id: v.string(), gridCol: v.number(), gridRow: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const project = await getOwnedProject(ctx, userId, args.id)
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
    const project = await getOwnedProject(ctx, userId, args.id)
    const now = Date.now()
    await ctx.db.patch(project._id, {
      status: args.status,
      finishedAt: args.status === 'done' ? now : null,
      shelvedAt: args.status === 'shelved' ? now : null,
    })
  },
})

export const deleteProject = mutation({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const project = await getOwnedProject(ctx, userId, args.id)
    // Hard delete cascades to the project's tasks.
    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_project', (q) => q.eq('projectId', args.id))
      .collect()
    await Promise.all(tasks.map((t) => ctx.db.delete(t._id)))
    await ctx.db.delete(project._id)
  },
})

/* ---------------------------------------------------------------- tasks */

export const createTask = mutation({
  args: {
    id: v.string(),
    projectId: v.string(),
    parentId: v.optional(v.union(v.string(), v.null())),
    title: v.string(),
    position: v.number(),
    dueAt: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const title = args.title.trim()
    if (!title) throw new Error('Task title is required')
    // Ownership of the destination project also gates task creation.
    await getOwnedProject(ctx, userId, args.projectId)
    const existing = await ctx.db
      .query('tasks')
      .withIndex('by_user_id', (q) => q.eq('userId', userId).eq('id', args.id))
      .unique()
    if (existing) return
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
    })
  },
})

export const updateTask = mutation({
  args: {
    id: v.string(),
    title: v.optional(v.string()),
    notes: v.optional(v.union(v.string(), v.null())),
    done: v.optional(v.boolean()),
    archived: v.optional(v.boolean()),
    dueAt: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const task = await getOwnedTask(ctx, userId, args.id)
    const { id: _id, done, ...rest } = args
    const patch: Partial<{
      title: string
      notes: string | null
      archived: boolean
      dueAt: number | null
      done: boolean
      doneAt: number | null
    }> = { ...rest }
    if (done !== undefined) {
      patch.done = done
      patch.doneAt = done ? Date.now() : null
    }
    await ctx.db.patch(task._id, patch)
  },
})

/** Move within a project or across projects. Focus membership is untouched.
 *  Subtasks travel with their parent. */
export const moveTask = mutation({
  args: { id: v.string(), projectId: v.string(), position: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const task = await getOwnedTask(ctx, userId, args.id)
    await getOwnedProject(ctx, userId, args.projectId)
    await ctx.db.patch(task._id, {
      projectId: args.projectId,
      position: args.position,
    })

    // The whole subtree travels with the task: walk the parentId graph over
    // this user's tasks and reassign every descendant's project (replaces the
    // original recursive SQL CTE).
    const all = await ctx.db
      .query('tasks')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    const childrenOf = new Map<string, Array<Doc<'tasks'>>>()
    for (const t of all) {
      if (!t.parentId) continue
      const list = childrenOf.get(t.parentId) ?? []
      list.push(t)
      childrenOf.set(t.parentId, list)
    }
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
 */
export const setTaskFocus = mutation({
  args: {
    id: v.string(),
    inFocus: v.boolean(),
    focusOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const task = await getOwnedTask(ctx, userId, args.id)
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
    const task = await getOwnedTask(ctx, userId, args.id)
    // Cascade to the subtree (children reference parentId).
    const all = await ctx.db
      .query('tasks')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    const childrenOf = new Map<string, Array<Doc<'tasks'>>>()
    for (const t of all) {
      if (!t.parentId) continue
      const list = childrenOf.get(t.parentId) ?? []
      list.push(t)
      childrenOf.set(t.parentId, list)
    }
    const toDelete = [task]
    const queue = [...(childrenOf.get(task.id) ?? [])]
    while (queue.length > 0) {
      const child = queue.shift()!
      toDelete.push(child)
      queue.push(...(childrenOf.get(child.id) ?? []))
    }
    await Promise.all(toDelete.map((t) => ctx.db.delete(t._id)))
  },
})
