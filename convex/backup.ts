import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import { requireUserId } from './lib'

/* Wire format: dates travel as ISO strings inside the JSON file, matching the
 * original Drizzle-era backup (so old backups import cleanly). `parentId` is
 * carried optionally — the original export dropped it; we keep it when present
 * and tolerate its absence. */

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
})

export const exportBackup = query({
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
      })),
    }
  },
})

/** Replaces everything for the signed-in user only. The UI confirms loudly. */
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

    // Wipe this user's existing rows, then restore from the snapshot.
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
    await Promise.all([
      ...tasks.map((t) => ctx.db.delete(t._id)),
      ...projects.map((p) => ctx.db.delete(p._id)),
    ])

    for (const p of data.projects) {
      const status = p.status === 'shelved' || p.status === 'done'
        ? p.status
        : 'active'
      await ctx.db.insert('projects', {
        userId,
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
      })
    }
    for (const t of data.tasks) {
      await ctx.db.insert('tasks', {
        userId,
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
        inFocus: Boolean(t.inFocus),
        focusOrder: Number(t.focusOrder ?? 0),
        createdAt: fromIso(t.createdAt) ?? Date.now(),
      })
    }
    return {
      ok: true,
      projects: data.projects.length,
      tasks: data.tasks.length,
    }
  },
})
