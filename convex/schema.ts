import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

/**
 * Project lifecycle mirrors the original Drizzle model:
 * - active:  lives on the board
 * - shelved: temporarily out of sight & out of mind (restorable)
 * - done:    finished, shows up in the Accomplished view
 * Permanent removal is a hard delete (cascades to tasks in the mutation).
 *
 * Everything is scoped by `userId` — the Clerk identity subject (the Clerk
 * user id, `ctx.auth.getUserIdentity().subject`). Each account is a
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
    // Per-project "show done" override; the board-wide switch still applies.
    // Optional so pre-existing rows don't need a migration.
    showDone: v.optional(v.boolean()),
    gridCol: v.number(),
    gridRow: v.number(),
    targetDate: v.union(v.number(), v.null()),
    createdAt: v.number(),
    finishedAt: v.union(v.number(), v.null()),
    shelvedAt: v.union(v.number(), v.null()),
    // Collaborative space association — optional so personal projects keep
    // working with no migration. When null/undefined the project is private.
    spaceId: v.optional(v.string()),
  })
    .index('by_user', ['userId'])
    // The app-facing `id` is only unique *per user* (client-generated uuids,
    // and migrations can leave the same id under an old + new userId), so
    // ownership lookups must scope by userId — never the bare `id` alone.
    .index('by_user_id', ['userId', 'id'])
    .index('by_space', ['spaceId']),

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
    reminderMinutes: v.optional(v.union(v.number(), v.null())),
    // The user's *intent* to mirror this task onto Google Calendar. Kept
    // separate from `calendarEventId` so the intent survives a failed or
    // pending Google call — the id is only ever a real Google event id.
    addToCalendar: v.optional(v.boolean()),
    calendarEventId: v.optional(v.union(v.string(), v.null())),
    inFocus: v.boolean(),
    focusOrder: v.number(),
    createdAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_project', ['projectId'])
    .index('by_user_id', ['userId', 'id']),

  spaces: defineTable({
    id: v.string(),
    ownerId: v.string(),
    name: v.string(),
    inviteCode: v.string(),
    createdAt: v.number(),
  })
    .index('by_owner', ['ownerId'])
    .index('by_inviteCode', ['inviteCode']),

  spaceMembers: defineTable({
    spaceId: v.string(),
    userId: v.string(),
    role: v.union(v.literal('owner'), v.literal('member')),
    joinedAt: v.number(),
  })
    .index('by_space', ['spaceId'])
    .index('by_user', ['userId'])
    .index('by_space_user', ['spaceId', 'userId']),

  userSettings: defineTable({
    userId: v.string(),
    // Two names for one switch, kept because existing rows have both. The
    // API surface exposes only `syncEnabled` (see convex/settings.ts) and
    // writes both fields together.
    calendarEnabled: v.boolean(),
    calendarSyncEnabled: v.boolean(),
    defaultReminderMinutes: v.number(),
    // Legacy. Whether Google is connected is now read from Clerk (the only
    // place that actually knows), never from a flag we set ourselves.
    googleConnected: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_user', ['userId']),
})
