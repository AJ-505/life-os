import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { requireMember, requireUserId } from './lib'

/** Matches the tracker's batch so a big delete behaves the same either way. */
const DELETE_BATCH = 200

import type { Doc } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

/** 32 symbols with no I, O, 0 or 1, so a code read aloud or copied by hand
 *  cannot be mistyped into another one. 10 of them is about 50 bits. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 10

/** Legacy codes are shorter and use a wider alphabet, so lookups accept them
 *  and only generation is strict. Live links keep working. */
const CODE_SHAPE = /^[A-Z0-9]{4,16}$/

const JOIN_WINDOW_MS = 5 * 60 * 1000
const JOIN_MAX_ATTEMPTS = 10

function newInviteCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}

function shapeSpace(s: Doc<'spaces'>) {
  return {
    id: s.id,
    ownerId: s.ownerId,
    name: s.name,
    inviteCode: s.inviteCode,
    createdAt: s.createdAt,
  }
}

async function spaceByInviteCode(
  ctx: QueryCtx | MutationCtx,
  inviteCode: string,
): Promise<Doc<'spaces'> | null> {
  return await ctx.db
    .query('spaces')
    .withIndex('by_inviteCode', (q) => q.eq('inviteCode', inviteCode))
    .unique()
}

async function unusedInviteCode(
  ctx: MutationCtx,
  excludeSpaceId?: string,
): Promise<string> {
  for (;;) {
    const code = newInviteCode()
    const taken = await spaceByInviteCode(ctx, code)
    if (!taken || taken.id === excludeSpaceId) return code
  }
}

/**
 * Count the attempt and report the wait when the window is spent. A sliding
 * window, and read with `.first()` so a duplicate row can never lock a user out
 * of joining forever. The throttle exists for the live 6-character legacy codes
 * at roughly 31 bits; a new 10-character code is already infeasible to guess,
 * and a per-account limit does not slow a multi-account attacker.
 */
async function joinThrottleMinutes(
  ctx: MutationCtx,
  userId: string,
): Promise<number | null> {
  const now = Date.now()
  const row = await ctx.db
    .query('inviteAttempts')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first()
  if (!row || now - row.windowStartAt > JOIN_WINDOW_MS) {
    if (row) await ctx.db.patch(row._id, { count: 1, windowStartAt: now })
    else
      await ctx.db.insert('inviteAttempts', {
        userId,
        count: 1,
        windowStartAt: now,
      })
    return null
  }
  const count = row.count + 1
  await ctx.db.patch(row._id, { count })
  if (count <= JOIN_MAX_ATTEMPTS) return null
  return Math.max(
    1,
    Math.ceil((row.windowStartAt + JOIN_WINDOW_MS - now) / 60000),
  )
}

export const createSpace = mutation({
  args: {
    name: v.string(),
    /**
     * Legacy fields the pre-release front end still sends. Convex rejects an
     * unknown field outright, so accepting and ignoring them is what keeps that
     * client working. The server generates the id and the code, and the old
     * client's success handler already ignores a non-string answer.
     *
     * Delete both, and tighten `getBoard` and `createProject` back to a
     * required `spaceId`, once Vercel points at its own deployment.
     */
    id: v.optional(v.string()),
    inviteCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const name = args.name.trim()
    if (!name) throw new Error('Space name is required')

    // Both the id and the code are generated here. Accepting either from the
    // client is what let one caller reach another caller's invite code.
    const id = crypto.randomUUID()
    const inviteCode = await unusedInviteCode(ctx)
    const createdAt = Date.now()
    await ctx.db.insert('spaces', {
      id,
      ownerId: userId,
      name,
      inviteCode,
      createdAt,
    })
    await ctx.db.insert('spaceMembers', {
      spaceId: id,
      userId,
      role: 'owner',
      joinedAt: createdAt,
    })
    return { id, ownerId: userId, name, inviteCode, createdAt }
  },
})

export type JoinResult =
  | {
      ok: true
      space: ReturnType<typeof shapeSpace>
      alreadyMember: boolean
    }
  | {
      ok: false
      reason: 'invalid' | 'not_found' | 'throttled'
      retryAfterMinutes?: number
    }

export const joinSpaceByCode = mutation({
  args: { inviteCode: v.string() },
  handler: async (ctx, args): Promise<JoinResult> => {
    const userId = await requireUserId(ctx)
    const code = args.inviteCode.trim().toUpperCase()
    if (!CODE_SHAPE.test(code)) return { ok: false, reason: 'invalid' }

    const wait = await joinThrottleMinutes(ctx, userId)
    if (wait !== null)
      return { ok: false, reason: 'throttled', retryAfterMinutes: wait }

    const space = await spaceByInviteCode(ctx, code)
    if (!space) return { ok: false, reason: 'not_found' }

    // `.first()`, for the same reason the guard uses it: a concurrent double
    // join can leave two rows, and a throwing read would lock the member out.
    const membership = await ctx.db
      .query('spaceMembers')
      .withIndex('by_space_user', (q) =>
        q.eq('spaceId', space.id).eq('userId', userId),
      )
      .first()
    if (!membership) {
      await ctx.db.insert('spaceMembers', {
        spaceId: space.id,
        userId,
        role: 'member',
        joinedAt: Date.now(),
      })
    }
    return {
      ok: true,
      space: shapeSpace(space),
      alreadyMember: membership !== null,
    }
  },
})

/**
 * Leaving hands the space on rather than stranding it. An owner's seat goes to
 * the longest-standing member, ordered by join time and then by user id so two
 * same-millisecond joins still pick the same successor, and the invite code is
 * rotated because the person leaving may still hold it.
 */
export const leaveSpace = mutation({
  args: { spaceId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const membership = await requireMember(ctx, userId, args.spaceId)
    const space = await ctx.db
      .query('spaces')
      .withIndex('by_app_id', (q) => q.eq('id', args.spaceId))
      .unique()
    if (!space) throw new Error('Space not found')

    const members = await ctx.db
      .query('spaceMembers')
      .withIndex('by_space', (q) => q.eq('spaceId', args.spaceId))
      .collect()
    const remaining = members
      .filter((m) => m.userId !== userId)
      .sort((a, b) => a.joinedAt - b.joinedAt || (a.userId < b.userId ? -1 : 1))

    if (space.ownerId === userId && remaining.length === 0)
      throw new Error(
        'You are the only member of this space. Delete it instead of leaving.',
      )

    await ctx.db.delete(membership._id)

    if (space.ownerId !== userId) return

    const successor = remaining[0]
    await ctx.db.patch(successor._id, { role: 'owner' })
    await ctx.db.patch(space._id, {
      ownerId: successor.userId,
      inviteCode: await unusedInviteCode(ctx, space.id),
    })
  },
})

export const getMySpaces = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx)
    const memberships = await ctx.db
      .query('spaceMembers')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    // The app-id index makes each of these a point read; running them together
    // keeps the count at K+1 reads instead of K serial round trips. Denormalizing
    // the space onto the membership row is the follow-up that makes it one.
    const resolved = await Promise.all(
      memberships.map(async (membership) => {
        const space = await ctx.db
          .query('spaces')
          .withIndex('by_app_id', (q) => q.eq('id', membership.spaceId))
          .unique()
        return space ? { ...shapeSpace(space), role: membership.role } : null
      }),
    )
    return resolved.filter((space) => space !== null)
  },
})

export const getSpaceMembers = query({
  args: { spaceId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    await requireMember(ctx, userId, args.spaceId)
    const members = await ctx.db
      .query('spaceMembers')
      .withIndex('by_space', (q) => q.eq('spaceId', args.spaceId))
      .collect()
    return members
      .sort((a, b) => a.joinedAt - b.joinedAt || (a.userId < b.userId ? -1 : 1))
      .map((m) => ({
        userId: m.userId,
        spaceId: m.spaceId,
        role: m.role,
        joinedAt: m.joinedAt,
        isSelf: m.userId === userId,
      }))
  },
})

export const deleteSpace = mutation({
  args: { spaceId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const space = await ctx.db
      .query('spaces')
      .withIndex('by_app_id', (q) => q.eq('id', args.spaceId))
      .unique()
    if (!space) throw new Error('Space not found')
    if (space.ownerId !== userId) throw new Error('Only owner can delete space')

    const members = await ctx.db
      .query('spaceMembers')
      .withIndex('by_space', (q) => q.eq('spaceId', args.spaceId))
      .collect()
    await Promise.all(members.map((m) => ctx.db.delete(m._id)))

    const [projects, tasks] = await Promise.all([
      ctx.db
        .query('projects')
        .withIndex('by_space', (q) => q.eq('spaceId', args.spaceId))
        .collect(),
      ctx.db
        .query('tasks')
        .withIndex('by_space', (q) => q.eq('spaceId', args.spaceId))
        .collect(),
    ])
    // One read for every task in the space, not one per project, and the
    // deletes are batched so a space larger than one transaction still goes.
    const ids = tasks.map((task) => task._id)
    const batch = ids.slice(0, DELETE_BATCH)
    await Promise.all(batch.map((id) => ctx.db.delete(id)))
    if (ids.length > batch.length) {
      await ctx.scheduler.runAfter(0, internal.tracker.continueDeleteTasks, {
        ids: ids.slice(batch.length),
      })
    }
    await Promise.all(projects.map((project) => ctx.db.delete(project._id)))

    await ctx.db.delete(space._id)
  },
})
