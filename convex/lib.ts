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

/** A board scope: the space's app id, or null for the caller's personal board. */
export type Scope = string | null

/**
 * Non-throwing membership check, the primitive the guard and the seam share.
 *
 * Read with `.first()`, not `.unique()`: `spaceMembers` has no unique index and
 * a join is a read-then-insert, so two tabs opening the same invite link can
 * both insert. `.unique()` would then throw on every later read, which would
 * make the whole space unreadable and unwritable for that member. Any one
 * membership row authorizes.
 */
export async function isSpaceMember(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  spaceId: string,
): Promise<boolean> {
  const membership = await ctx.db
    .query('spaceMembers')
    .withIndex('by_space_user', (q) =>
      q.eq('spaceId', spaceId).eq('userId', userId),
    )
    .first()
  return membership !== null
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
    .first()
  if (!membership) throw new Error('Not a member of this space')
  return membership
}

/** Verify membership and return the space. Resolves through the app-id index,
 *  never a table scan. */
export async function getMemberSpace(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  spaceId: string,
) {
  const space = await ctx.db
    .query('spaces')
    .withIndex('by_app_id', (q) => q.eq('id', spaceId))
    .unique()
  if (!space) throw new Error('Space not found')
  await requireMember(ctx, userId, spaceId)
  return space
}

/* ------------------------------------------------------------- the seam
 * The single write-authorization boundary. A row is writable when the caller
 * owns it, or when it belongs to a space the caller is a member of. The caller
 * is derived from the verified identity and never from arguments.
 *
 * The app-facing `id` is only unique per user, so a lookup collects rather than
 * uniques. Every candidate is authorized individually, which is why a row that
 * belongs to someone else can never be selected: a planted id cannot hijack a
 * write, and it cannot block one either, because another user's row is not a
 * candidate at all. Two *authorized* candidates means the caller's own data is
 * ambiguous, and that throws rather than guessing.
 */

export async function getWritableProject(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  id: string,
): Promise<Doc<'projects'>> {
  const candidates = await ctx.db
    .query('projects')
    .withIndex('by_app_id', (q) => q.eq('id', id))
    .collect()
  const authorized: Array<Doc<'projects'>> = []
  for (const project of candidates) {
    if (project.userId === userId) authorized.push(project)
    else if (
      project.spaceId &&
      (await isSpaceMember(ctx, userId, project.spaceId))
    )
      authorized.push(project)
  }
  if (authorized.length === 1) return authorized[0]
  if (authorized.length === 0) throw new Error('Project not found')
  throw new Error('That project id exists on more than one of your boards')
}

export async function getWritableTask(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  id: string,
): Promise<Doc<'tasks'>> {
  const candidates = await ctx.db
    .query('tasks')
    .withIndex('by_app_id', (q) => q.eq('id', id))
    .collect()
  const authorized: Array<Doc<'tasks'>> = []
  for (const task of candidates) {
    if (task.userId === userId) authorized.push(task)
    else if (task.spaceId && (await isSpaceMember(ctx, userId, task.spaceId)))
      authorized.push(task)
  }
  if (authorized.length === 1) return authorized[0]
  if (authorized.length === 0) throw new Error('Task not found')
  throw new Error('That task id exists on more than one of your boards')
}

/* -------------------------------------------------------- scope reads
 * One reader per scope, so the personal-versus-shared rule has a single home.
 * `spaceId === null` is personal, which the schema encodes as an absent
 * `spaceId`; anything else is a shared board the caller has already been
 * checked against.
 */

export async function scopeTasks(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  spaceId: Scope,
): Promise<Array<Doc<'tasks'>>> {
  if (spaceId === null) {
    const rows = await ctx.db
      .query('tasks')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    return rows.filter((task) => !task.spaceId)
  }
  return await ctx.db
    .query('tasks')
    .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
    .collect()
}

/**
 * Remove every membership row a user holds in a space.
 *
 * `spaceMembers` has no unique index and a join is a read-then-insert, so two
 * rows for one pair are reachable (see the note on `isSpaceMember`). Deleting
 * only the row a read happened to return leaves the pair with a row, which
 * means the user keeps full access. Anything that revokes access uses this.
 */
export async function dropMembership(
  ctx: MutationCtx,
  spaceId: string,
  userId: string,
): Promise<number> {
  const rows = await ctx.db
    .query('spaceMembers')
    .withIndex('by_space_user', (q) =>
      q.eq('spaceId', spaceId).eq('userId', userId),
    )
    .collect()
  await Promise.all(rows.map((row) => ctx.db.delete(row._id)))
  return rows.length
}

/** Fetch userSettings row for a user, or null if not yet created. */
export async function getUserSettings(
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<Doc<'userSettings'> | null> {
  // `.first()` for the same reason as the membership read: the row is created
  // on first write, and a duplicate written from outside this mutation must not
  // break every calendar call for that user.
  return await ctx.db
    .query('userSettings')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first()
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
 * Optional-in-schema fields are normalized so the client never has to decide
 * what `undefined` means, which is also what makes "absent means personal"
 * arrive as `null`.
 */

export function shapeProject(p: Doc<'projects'>) {
  const { _id, _creationTime, userId: _userId, ...rest } = p
  return {
    ...rest,
    showDone: p.showDone ?? false,
    spaceId: p.spaceId ?? null,
  }
}

export function shapeTask(t: Doc<'tasks'>) {
  const { _id, _creationTime, userId: _userId, ...rest } = t
  return {
    ...rest,
    reminderMinutes: t.reminderMinutes ?? null,
    addToCalendar: t.addToCalendar ?? false,
    calendarEventId: t.calendarEventId ?? null,
    assigneeId: t.assigneeId ?? null,
    spaceId: t.spaceId ?? null,
  }
}
