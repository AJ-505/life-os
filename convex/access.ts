import type { Auth } from 'convex/server'
import type { Doc } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

type Ctx = QueryCtx | MutationCtx

export type Scope = string | null

type BoardTable = 'projects' | 'tasks'

const NOUN = { projects: 'project', tasks: 'task' } as const

export async function requireUserId(ctx: { auth: Auth }): Promise<string> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error('Not authenticated')
  return identity.subject
}

export async function membership(
  ctx: Ctx,
  userId: string,
  spaceId: string,
): Promise<Doc<'spaceMembers'> | null> {
  return await ctx.db
    .query('spaceMembers')
    .withIndex('by_space_user', (q) =>
      q.eq('spaceId', spaceId).eq('userId', userId),
    )
    .first()
}

export async function requireMember(
  ctx: Ctx,
  userId: string,
  spaceId: string,
): Promise<Doc<'spaceMembers'>> {
  const member = await membership(ctx, userId, spaceId)
  if (!member) throw new Error('Not a member of this space')
  return member
}

export async function getMemberSpace(
  ctx: Ctx,
  userId: string,
  spaceId: string,
): Promise<Doc<'spaces'>> {
  const space = await ctx.db
    .query('spaces')
    .withIndex('by_app_id', (q) => q.eq('id', spaceId))
    .unique()
  if (!space) throw new Error('Space not found')
  await requireMember(ctx, userId, spaceId)
  return space
}

export async function requireScope(ctx: Ctx, userId: string, scope: Scope) {
  if (scope !== null) await getMemberSpace(ctx, userId, scope)
}

type ByTable = {
  [K in BoardTable]: (ctx: Ctx, key: string) => Promise<Array<Doc<K>>>
}

const BY_APP_ID: ByTable = {
  projects: (ctx, id) =>
    ctx.db
      .query('projects')
      .withIndex('by_app_id', (q) => q.eq('id', id))
      .take(16),
  tasks: (ctx, id) =>
    ctx.db
      .query('tasks')
      .withIndex('by_app_id', (q) => q.eq('id', id))
      .take(16),
}

const IN_SPACE: ByTable = {
  projects: (ctx, spaceId) =>
    ctx.db
      .query('projects')
      .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
      .collect(),
  tasks: (ctx, spaceId) =>
    ctx.db
      .query('tasks')
      .withIndex('by_space', (q) => q.eq('spaceId', spaceId))
      .collect(),
}

const PERSONAL: ByTable = {
  projects: (ctx, userId) =>
    ctx.db
      .query('projects')
      .withIndex('by_user_space', (q) =>
        q.eq('userId', userId).eq('spaceId', null),
      )
      .collect(),
  tasks: (ctx, userId) =>
    ctx.db
      .query('tasks')
      .withIndex('by_user_space', (q) =>
        q.eq('userId', userId).eq('spaceId', null),
      )
      .collect(),
}

async function reachable<T extends BoardTable>(
  ctx: Ctx,
  userId: string,
  table: T,
  id: string,
): Promise<Array<Doc<T>>> {
  const candidates = await BY_APP_ID[table](ctx, id)
  const memberOf = new Map<string, boolean>()
  const isMember = async (spaceId: string) => {
    const known = memberOf.get(spaceId)
    if (known !== undefined) return known
    const found = (await membership(ctx, userId, spaceId)) !== null
    memberOf.set(spaceId, found)
    return found
  }
  const found: Array<Doc<T>> = []
  for (const row of candidates) {
    if (row.userId === userId || (row.spaceId && (await isMember(row.spaceId))))
      found.push(row)
  }
  return found
}

export async function getWritable<T extends BoardTable>(
  ctx: Ctx,
  userId: string,
  table: T,
  id: string,
): Promise<Doc<T>> {
  const found = await reachable(ctx, userId, table, id)
  if (found.length === 1) return found[0]
  const noun = NOUN[table]
  if (found.length === 0)
    throw new Error(`${noun[0].toUpperCase()}${noun.slice(1)} not found`)
  throw new Error(`That ${noun} id exists on more than one of your boards`)
}

export async function idTakenInScope(
  ctx: MutationCtx,
  userId: string,
  table: BoardTable,
  id: string,
  scope: Scope,
): Promise<boolean> {
  const found = await reachable(ctx, userId, table, id)
  if (found.length === 0) return false
  if (found.every((row) => (row.spaceId ?? null) === scope)) return true
  throw new Error(
    `That ${NOUN[table]} id is already used on another of your boards`,
  )
}

export async function boardRows<T extends BoardTable>(
  ctx: Ctx,
  userId: string,
  table: T,
  scope: Scope,
): Promise<Array<Doc<T>>> {
  return scope === null
    ? await PERSONAL[table](ctx, userId)
    : await IN_SPACE[table](ctx, scope)
}

export async function ownTask(
  ctx: Ctx,
  userId: string,
  id: string,
): Promise<Doc<'tasks'> | null> {
  return await ctx.db
    .query('tasks')
    .withIndex('by_user_id', (q) => q.eq('userId', userId).eq('id', id))
    .first()
}
