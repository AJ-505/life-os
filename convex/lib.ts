import type { MutationCtx, QueryCtx } from './_generated/server'

/** Every public function starts here: derive the caller from the verified Clerk
 *  identity (the JWT `subject` — the Clerk user id — validated by Convex against
 *  Clerk's JWKS, never from arguments) and reject anonymous access. */
export async function requireUserId(
  ctx: QueryCtx | MutationCtx,
): Promise<string> {
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
