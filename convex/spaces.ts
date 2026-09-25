import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { dropMembership, requireMember, requireUserId } from './lib'

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

async function profileForUser(
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<Doc<'userProfiles'> | null> {
  return await ctx.db
    .query('userProfiles')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first()
}

function memberName(profile: Doc<'userProfiles'> | null): string {
  return profile?.displayName?.trim() || 'Member'
}

function memberInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'ME'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words.at(-1)?.[0] ?? ''}`.toUpperCase()
}

/** Keep the directory current without making Clerk a database lookup on every
 *  board read. The identity is still the only authorization source. */
export const syncUserProfile = mutation({
  args: {
    displayName: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Not authenticated')
    const displayName = args.displayName?.trim() || identity.name || 'Member'
    const email = args.email?.trim() || identity.email || undefined
    const existing = await profileForUser(ctx, identity.subject)
    if (existing) {
      await ctx.db.patch(existing._id, {
        displayName,
        ...(email ? { email } : {}),
        updatedAt: Date.now(),
      })
      return
    }
    await ctx.db.insert('userProfiles', {
      userId: identity.subject,
      displayName,
      ...(email ? { email } : {}),
      updatedAt: Date.now(),
    })
  },
})

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

    // `.first()`, for the same reason the guard uses it: the pair is not unique
    // by construction, so a duplicate from outside this mutation must not lock
    // the member out with a throwing read.
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
    await requireMember(ctx, userId, args.spaceId)
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

    // Every row, not the one this read happened to return: a duplicate would
    // otherwise keep the leaver's access alive.
    await dropMembership(ctx, args.spaceId, userId)

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
        // The role is derived from the space's `ownerId`, which is the one
        // authority for who owns it. Reading the membership row's stored role
        // instead would be a second copy that can drift, and the UI gates
        // owner-only controls on this.
        return space
          ? {
              ...shapeSpace(space),
              role: space.ownerId === userId ? 'owner' : membership.role,
            }
          : null
      }),
    )
    // A duplicate membership row would otherwise list the same space twice and
    // give React two identical keys.
    const byId = new Map<string, NonNullable<(typeof resolved)[number]>>()
    for (const space of resolved) {
      if (space && !byId.has(space.id)) byId.set(space.id, space)
    }
    return [...byId.values()]
  },
})

export const getSpaceMembers = query({
  args: { spaceId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    await requireMember(ctx, userId, args.spaceId)
    const membershipRows = await ctx.db
      .query('spaceMembers')
      .withIndex('by_space', (q) => q.eq('spaceId', args.spaceId))
      .collect()
    const space = await ctx.db
      .query('spaces')
      .withIndex('by_app_id', (q) => q.eq('id', args.spaceId))
      .unique()
    const sorted = membershipRows.sort(
      (a, b) => a.joinedAt - b.joinedAt || (a.userId < b.userId ? -1 : 1),
    )
    // Same two reasons as `getMySpaces`: the role comes from `spaces.ownerId`,
    // and a duplicate row must not render the same person twice.
    const seen = new Set<string>()
    const members = sorted.flatMap((m) => {
      if (seen.has(m.userId)) return []
      seen.add(m.userId)
      return [
        {
          userId: m.userId,
          spaceId: m.spaceId,
          role: space?.ownerId === m.userId ? ('owner' as const) : m.role,
          joinedAt: m.joinedAt,
          isSelf: m.userId === userId,
        },
      ]
    })
    return await Promise.all(
      members.map(async (member) => {
        const profile = await profileForUser(ctx, member.userId)
        const name = memberName(profile)
        return {
          ...member,
          name,
          initials: memberInitials(name),
        }
      }),
    )
  },
})

/**
 * Rotation, shared by both revocation paths. The code is the credential, so
 * anything that takes access away has to change it: removing a membership row
 * while the removed person still holds the code leaves them one page load from
 * walking back in.
 */
async function rotateInviteCode(ctx: MutationCtx, space: Doc<'spaces'>) {
  // The space document, not its app id: `patch` wants the Convex `_id`, and the
  // string id would address nothing.
  const code = await unusedInviteCode(ctx, space.id)
  await ctx.db.patch(space._id, { inviteCode: code })
  return code
}

/** Owner-only check, with one clear message for the member case. */
function assertOwner(space: Doc<'spaces'>, userId: string) {
  if (space.ownerId !== userId)
    throw new Error('Only the owner can do that with this space')
}

/**
 * Issue a new invite link for the whole space. For "the link leaked and I do
 * not know who has it". Everyone already in stays in; anyone holding the old
 * link cannot use it any more.
 */
export const resetInviteCode = mutation({
  args: { spaceId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const space = await ctx.db
      .query('spaces')
      .withIndex('by_app_id', (q) => q.eq('id', args.spaceId))
      .unique()
    if (!space) throw new Error('Space not found')
    assertOwner(space, userId)
    return { inviteCode: await rotateInviteCode(ctx, space) }
  },
})

/**
 * Take one person's access away: their memberships go, and the code changes in
 * the same transaction so the link they hold stops working. Both halves are
 * needed; either alone leaves them able to return.
 *
 * A member's own projects and tasks are untouched: they belong to the space and
 * carry their own creator, not a grant.
 */
export const removeMember = mutation({
  args: { spaceId: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    const caller = await requireUserId(ctx)
    const space = await ctx.db
      .query('spaces')
      .withIndex('by_app_id', (q) => q.eq('id', args.spaceId))
      .unique()
    if (!space) throw new Error('Space not found')
    assertOwner(space, caller)
    if (args.userId === caller)
      throw new Error('Leave the space instead of removing yourself')
    if (args.userId === space.ownerId)
      throw new Error('The owner cannot be removed. Delete the space instead.')

    const removed = await dropMembership(ctx, space.id, args.userId)
    // Rotating after a no-op would break the link for people who have not
    // joined yet, in exchange for removing nobody.
    if (removed === 0)
      throw new Error('That person is not a member of this space')

    return { inviteCode: await rotateInviteCode(ctx, space) }
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
