import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

/**
 * Project lifecycle mirrors the original Drizzle model:
 * - active:  lives on the board
 * - shelved: temporarily out of sight & out of mind (restorable)
 * - done:    finished, shows up in the Accomplished view
 * Permanent removal is a hard delete (cascades to tasks in the mutation).
 *
 * Everything is scoped by `userId` — the shoo identity subject (a stable
 * per-app string id, `ctx.auth.getUserIdentity().subject`). Each account is a
 * fully private LifeOS. The string `id` (client-generated uuid) is kept as the
 * app-facing identity — relationships are string refs (`projectId`,
 * `parentId`) so the UI and optimistic updates never learn about Convex's
 * internal `_id`. Timestamps are epoch-ms numbers.
 */
export default defineSchema({
  projects: defineTable({
    userId: v.string(),
    id: v.string(),
    name: v.string(),
    color: v.string(),
    status: v.union(
      v.literal('active'),
      v.literal('shelved'),
      v.literal('done'),
    ),
    collapsed: v.boolean(),
    gridCol: v.number(),
    gridRow: v.number(),
    targetDate: v.union(v.number(), v.null()),
    createdAt: v.number(),
    finishedAt: v.union(v.number(), v.null()),
    shelvedAt: v.union(v.number(), v.null()),
  })
    .index('by_user', ['userId'])
    .index('id', ['id']),

  tasks: defineTable({
    userId: v.string(),
    id: v.string(),
    projectId: v.string(),
    parentId: v.union(v.string(), v.null()),
    title: v.string(),
    notes: v.union(v.string(), v.null()),
    position: v.number(),
    done: v.boolean(),
    doneAt: v.union(v.number(), v.null()),
    archived: v.boolean(),
    dueAt: v.union(v.number(), v.null()),
    inFocus: v.boolean(),
    focusOrder: v.number(),
    createdAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_project', ['projectId'])
    .index('id', ['id']),
})
