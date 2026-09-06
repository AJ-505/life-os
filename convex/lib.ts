import type { Auth } from 'convex/server'
import type { Doc } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

/** Every public function starts here: derive the caller from the verified Clerk
 *  identity (the JWT `subject` — the Clerk user id — validated by Convex against
 *  Clerk's JWKS, never from arguments) and reject anonymous access.
 *
 *  Typed on `auth` alone rather than on a ctx union so actions can use it too:
 *  an ActionCtx carries the same verified identity but has no `db`. */
export async function requireUserId(ctx: { auth: Auth }): Promise<string> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error('Not authenticated')
  return identity.subject
}

/** Look up a project by its app-facing string id and assert the caller owns it.
 *  This is the per-user isolation boundary for every project write. */
export async function getOwnedProject(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  id: string,
) {
  const project = await ctx.db
    .query('projects')
    .withIndex('by_user_id', (q) => q.eq('userId', userId).eq('id', id))
    .unique()
  if (!project) throw new Error('Project not found')
  return project
}

/** Same ownership boundary for tasks. */
export async function getOwnedTask(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  id: string,
) {
  const task = await ctx.db
    .query('tasks')
    .withIndex('by_user_id', (q) => q.eq('userId', userId).eq('id', id))
    .unique()
  if (!task) throw new Error('Task not found')
  return task
}

/** Require that userId is a member of spaceId. Returns the membership row. */
export async function requireMember(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  spaceId: string,
) {
  const membership = await ctx.db
    .query('spaceMembers')
    .withIndex('by_space_user', (q) =>
      q.eq('spaceId', spaceId).eq('userId', userId),
    )
    .unique()
  if (!membership) throw new Error('Not a member of this space')
  return membership
}

/** Verify membership and return the space document. */
export async function getOwnedSpace(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  spaceId: string,
) {
  const space = await ctx.db
    .query('spaces')
    .filter((q) => q.eq(q.field('id'), spaceId))
    .first()
  if (!space) throw new Error('Space not found')
  await requireMember(ctx, userId, spaceId)
  return space
}

/** Fetch userSettings row for a user, or null if not yet created. */
export async function getUserSettings(
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<Doc<'userSettings'> | null> {
  const row = await ctx.db
    .query('userSettings')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .unique()
  return row
}

/* ------------------------------------------------------------------ shaping
 * One shaper per table, shared by every query that returns rows. Written as
 * an *omission* (strip the private fields, spread the rest) rather than an
 * enumeration, so a new schema field flows through automatically. The
 * hand-written field lists these replace had already gone stale: `getBoard`
 * silently dropped `reminderMinutes` and `calendarEventId` while the copy in
 * spaces.ts returned them.
 *
 * Convex system fields (`_id`, `_creationTime`) and the private `userId`
 * never leave here — the app's identity is the client-generated string `id`.
 */

export function shapeProject(p: Doc<'projects'>) {
  const { _id, _creationTime, userId, ...rest } = p
  return {
    ...rest,
    // Optional-in-schema fields get normalised so the client never has to
    // decide what `undefined` means.
    showDone: p.showDone ?? false,
    spaceId: p.spaceId ?? null,
  }
}

export function shapeTask(t: Doc<'tasks'>) {
  const { _id, _creationTime, userId, ...rest } = t
  return {
    ...rest,
    reminderMinutes: t.reminderMinutes ?? null,
    addToCalendar: t.addToCalendar ?? false,
    calendarEventId: t.calendarEventId ?? null,
  }
}
