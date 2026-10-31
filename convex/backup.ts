import { v } from 'convex/values'

import type { Infer } from 'convex/values'

import { internalMutation, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { requireUserId } from './lib'
import { eventsToDelete } from './calendar'

import type { Doc } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

const IMPORT_BATCH = 200

const toIso = (v: number | null) => (v ? new Date(v).toISOString() : null)
const fromIso = (s: string | null | undefined) =>
  s ? new Date(s).getTime() : null

const backupProject = v.object({
  id: v.string(),
  name: v.string(),
  color: v.union(v.string(), v.null()),
  status: v.union(v.string(), v.null()),
  collapsed: v.union(v.boolean(), v.null()),
  gridCol: v.union(v.number(), v.null()),
  gridRow: v.union(v.number(), v.null()),
  targetDate: v.union(v.string(), v.null()),
  createdAt: v.union(v.string(), v.null()),
  finishedAt: v.union(v.string(), v.null()),
  shelvedAt: v.union(v.string(), v.null()),
})

const backupTask = v.object({
  id: v.string(),
  projectId: v.string(),
  parentId: v.optional(v.union(v.string(), v.null())),
  title: v.string(),
  notes: v.union(v.string(), v.null()),
  position: v.union(v.number(), v.null()),
  done: v.union(v.boolean(), v.null()),
  doneAt: v.union(v.string(), v.null()),
  archived: v.union(v.boolean(), v.null()),
  dueAt: v.union(v.string(), v.null()),
  inFocus: v.union(v.boolean(), v.null()),
  focusOrder: v.union(v.number(), v.null()),
  createdAt: v.union(v.string(), v.null()),
  reminderMinutes: v.optional(v.union(v.number(), v.null())),
  addToCalendar: v.optional(v.union(v.boolean(), v.null())),
  calendarEventId: v.optional(v.union(v.string(), v.null())),
})

async function personalRows(ctx: QueryCtx | MutationCtx, userId: string) {
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
  return {
    projects: projects.filter((project) => !project.spaceId),
    tasks: tasks.filter((task) => !task.spaceId),
  }
}

export const exportBackup = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx)
    const { projects, tasks } = await personalRows(ctx, userId)
    return {
      app: 'lifeos' as const,
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        status: p.status,
        collapsed: p.collapsed,
        gridCol: p.gridCol,
        gridRow: p.gridRow,
        targetDate: toIso(p.targetDate),
        createdAt: toIso(p.createdAt),
        finishedAt: toIso(p.finishedAt),
        shelvedAt: toIso(p.shelvedAt),
      })),
      tasks: tasks.map((t) => ({
        id: t.id,
        projectId: t.projectId,
        parentId: t.parentId,
        title: t.title,
        notes: t.notes,
        position: t.position,
        done: t.done,
        doneAt: toIso(t.doneAt),
        archived: t.archived,
        dueAt: toIso(t.dueAt),
        inFocus: t.inFocus,
        focusOrder: t.focusOrder,
        createdAt: toIso(t.createdAt),
        reminderMinutes: t.reminderMinutes ?? null,
        addToCalendar: t.addToCalendar ?? false,
        calendarEventId: t.calendarEventId ?? null,
      })),
    }
  },
})

export const importBackup = mutation({
  args: {
    app: v.literal('lifeos'),
    version: v.number(),
    exportedAt: v.string(),
    projects: v.array(backupProject),
    tasks: v.array(backupTask),
  },
  handler: async (ctx, data) => {
    const userId = await requireUserId(ctx)
    const { projects, tasks } = await personalRows(ctx, userId)

    const snapshotById = new Map(
      data.tasks.map((task) => [task.id, task.calendarEventId ?? null]),
    )
    const staleEvents = new Map<string, { taskId: string; eventId: string }>()
    for (const task of tasks) {
      const live = task.calendarEventId ?? null
      const snapshot = snapshotById.get(task.id) ?? null
      if (live && live !== snapshot) {
        staleEvents.set(live, { taskId: task.id, eventId: live })
      }
    }
    for (const event of eventsToDelete(
      tasks.filter((task) => !task.calendarEventId),
    ))
      staleEvents.set(event.eventId, event)
    if (staleEvents.size > 0) {
      await ctx.scheduler.runAfter(0, internal.calendar.deleteEventsForUser, {
        userId,
        events: [...staleEvents.values()],
      })
    }

    const projectsById = new Map(data.projects.map((p) => [p.id, p]))
    const tasksById = new Map(data.tasks.map((t) => [t.id, t]))

    await importBackupSide(ctx, {
      userId,
      deleteProjectIds: projects.map((p) => p._id),
      deleteTaskIds: tasks.map((t) => t._id),
      projects: [...projectsById.values()],
      tasks: [...tasksById.values()],
    })

    return {
      ok: true,
      projects: projectsById.size,
      tasks: tasksById.size,
    }
  },
})

const importSide = v.object({
  userId: v.string(),
  deleteProjectIds: v.array(v.string()),
  deleteTaskIds: v.array(v.string()),
  projects: v.array(backupProject),
  tasks: v.array(backupTask),
})

export const continueImportBackup = internalMutation({
  args: { side: importSide },
  handler: async (ctx, args) => {
    await importBackupSide(ctx, args.side)
  },
})

async function importBackupSide(
  ctx: MutationCtx,
  side: {
    userId: string
    deleteProjectIds: string[]
    deleteTaskIds: string[]
    projects: Array<Infer<typeof backupProject>>
    tasks: Array<Infer<typeof backupTask>>
  },
) {
  await Promise.all([
    ...side.deleteProjectIds
      .slice(0, IMPORT_BATCH)
      .map((id) => ctx.db.delete(id as Doc<'projects'>['_id'])),
    ...side.deleteTaskIds
      .slice(0, IMPORT_BATCH)
      .map((id) => ctx.db.delete(id as Doc<'tasks'>['_id'])),
  ])

  const projectBatch = side.projects.slice(0, IMPORT_BATCH)
  for (const p of projectBatch) {
    const status =
      p.status === 'shelved' || p.status === 'done' ? p.status : 'active'
    await ctx.db.insert('projects', {
      userId: side.userId,
      id: p.id,
      name: p.name,
      color: p.color ?? 'moss',
      status,
      collapsed: Boolean(p.collapsed),
      gridCol: Number(p.gridCol ?? 0),
      gridRow: Number(p.gridRow ?? 0),
      targetDate: fromIso(p.targetDate),
      createdAt: fromIso(p.createdAt) ?? Date.now(),
      finishedAt: fromIso(p.finishedAt),
      shelvedAt: fromIso(p.shelvedAt),
      spaceId: null,
    })
  }

  const taskBatch = side.tasks.slice(0, IMPORT_BATCH)
  for (const t of taskBatch) {
    await ctx.db.insert('tasks', {
      userId: side.userId,
      id: t.id,
      projectId: t.projectId,
      parentId: t.parentId ?? null,
      title: t.title,
      notes: t.notes ?? null,
      position: Number(t.position ?? 0),
      done: Boolean(t.done),
      doneAt: fromIso(t.doneAt),
      archived: Boolean(t.archived),
      dueAt: fromIso(t.dueAt),
      reminderMinutes: t.reminderMinutes ?? null,
      addToCalendar: Boolean(t.addToCalendar),
      calendarEventId: t.calendarEventId ?? null,
      inFocus: Boolean(t.inFocus),
      focusOrder: Number(t.focusOrder ?? 0),
      createdAt: fromIso(t.createdAt) ?? Date.now(),
      spaceId: null,
    })
  }

  const remaining = {
    userId: side.userId,
    deleteProjectIds: side.deleteProjectIds.slice(IMPORT_BATCH),
    deleteTaskIds: side.deleteTaskIds.slice(IMPORT_BATCH),
    projects: side.projects.slice(IMPORT_BATCH),
    tasks: side.tasks.slice(IMPORT_BATCH),
  }
  const done =
    remaining.deleteProjectIds.length === 0 &&
    remaining.deleteTaskIds.length === 0 &&
    remaining.projects.length === 0 &&
    remaining.tasks.length === 0
  if (!done) {
    await ctx.scheduler.runAfter(0, internal.backup.continueImportBackup, {
      side: remaining,
    })
  }
}
