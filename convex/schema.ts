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
 * user id, `ctx.auth.getUserIdentity().subject`). Each account is a fully
 * private LifeOS. The string `id` (client-generated uuid) is kept as the
 * app-facing identity — relationships are string refs (`projectId`,
 * `parentId`) so the UI and optimistic updates never learn about Convex's
 * internal `_id`. Timestamps are epoch-ms numbers.
 *
 * `spaceId` is the one collaborative axis. It is absent for personal rows and
 * set to the space's app id for shared ones. Every read that filters on it
 * treats "absent" as personal, so existing rows need no migration.
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
    // Collaborative space association — absent means private. Set at creation
    // and never updated: moving a project between boards would need cascade
    // decisions for its tasks, its focus members and its calendar events.
    spaceId: v.optional(v.string()),
  })
    .index('by_user', ['userId'])
    // The app-facing `id` is only unique *per user* (client-generated uuids,
    // and migrations can leave the same id under an old + new userId), so
    // ownership lookups must scope by userId — never the bare `id` alone.
    .index('by_user_id', ['userId', 'id'])
    .index('by_space', ['spaceId'])
    // Not `by_id`: Convex reserves that name for the implicit `_id` index.
    // Used by the authorization seam, which must find a project without
    // knowing who owns it, then decide whether the caller may touch it.
    .index('by_app_id', ['id']),

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
    // Denormalized from the project so a board reads one index and a walk can
    // never cross scopes. Kept equal to the project's by the same-scope rule.
    spaceId: v.optional(v.string()),
  })
    .index('by_user', ['userId'])
    .index('by_user_id', ['userId', 'id'])
    .index('by_app_id', ['id'])
    .index('by_space', ['spaceId'])
    // The two project-scoped reads. A single `projectId` index would be the
    // same query for every user and would leak across accounts whose
    // client-generated ids collide.
    .index('by_user_project', ['userId', 'projectId'])
    .index('by_space_project', ['spaceId', 'projectId']),

  spaces: defineTable({
    id: v.string(),
    ownerId: v.string(),
    name: v.string(),
    inviteCode: v.string(),
    createdAt: v.number(),
  })
    .index('by_inviteCode', ['inviteCode'])
    .index('by_app_id', ['id']),

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
    // IANA name. Google needs an explicit zone or it reads an offset-bearing
    // timestamp as a fixed instant and the wall clock shifts. Absent means the
    // client has not reported one yet, which is a distinct sync outcome.
    timeZone: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_user', ['userId']),

  /** One row per user, holding a sliding window of failed join attempts. The
   *  throttle exists for the live 6-character legacy codes at roughly 31 bits,
   *  not for the 10-character codes this version generates at roughly 50. */
  inviteAttempts: defineTable({
    userId: v.string(),
    count: v.number(),
    windowStartAt: v.number(),
  }).index('by_user', ['userId']),
})
