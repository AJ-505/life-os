import { v } from 'convex/values'

import { internalMutation, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { dropMembership, requireMember, requireUserId } from './lib'

import type { Doc } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 10

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

async function joinThrottleStartWindow(
  ctx: MutationCtx,
  userId: string,
  priorRow: Doc<'inviteAttempts'> | null,
  now: number,
): Promise<{ count: number; windowStartAt: number }> {
  const inWindow =
    priorRow !== null && now - priorRow.windowStartAt <= JOIN_WINDOW_MS
  const row = inWindow
    ? { count: priorRow.count + 1, windowStartAt: priorRow.windowStartAt }
    : { count: 1, windowStartAt: now }
  if (priorRow) await ctx.db.patch(priorRow._id, row)
  else
    await ctx.db.insert('inviteAttempts', {
      userId,
      count: row.count,
      windowStartAt: row.windowStartAt,
    })
  return row
}

function joinThrottleWaitMinutes(
  row: { count: number; windowStartAt: number } | null,
  now: number,
): number | null {
  if (!row || now - row.windowStartAt > JOIN_WINDOW_MS) return null
  if (row.count < JOIN_MAX_ATTEMPTS) return null
  return Math.max(
    1,
    Math.ceil((row.windowStartAt + JOIN_WINDOW_MS - now) / 60000),
  )
}

export const createSpace = mutation({
  args: {
    name: v.string(),
    id: v.optional(v.string()),
    inviteCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const name = args.name.trim()
    if (!name) throw new Error('Space name is required')

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

    const now = Date.now()
    const throttleRow = await ctx.db
      .query('inviteAttempts')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()
    const settledWait = joinThrottleWaitMinutes(throttleRow, now)
    if (settledWait !== null)
      return { ok: false, reason: 'throttled', retryAfterMinutes: settledWait }

    const space = await spaceByInviteCode(ctx, code)
    if (!space) {
      const row = await joinThrottleStartWindow(ctx, userId, throttleRow, now)
      const wait = joinThrottleWaitMinutes(row, now)
      return wait === null
        ? { ok: false, reason: 'not_found' }
        : { ok: false, reason: 'throttled', retryAfterMinutes: wait }
    }

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

    await dropMembership(ctx, args.spaceId, userId)
    await scheduleUnassign(ctx, args.spaceId, userId)

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
    const resolved = await Promise.all(
      memberships.map(async (membership) => {
        const space = await ctx.db
          .query('spaces')
          .withIndex('by_app_id', (q) => q.eq('id', membership.spaceId))
          .unique()
        return space
          ? {
              ...shapeSpace(space),
              role: space.ownerId === userId ? 'owner' : membership.role,
            }
          : null
      }),
    )
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

async function rotateInviteCode(ctx: MutationCtx, space: Doc<'spaces'>) {
  const code = await unusedInviteCode(ctx, space.id)
  await ctx.db.patch(space._id, { inviteCode: code })
  return code
}

function assertOwner(space: Doc<'spaces'>, userId: string) {
  if (space.ownerId !== userId)
    throw new Error('Only the owner can do that with this space')
}

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
    if (removed === 0)
      throw new Error('That person is not a member of this space')

    await scheduleUnassign(ctx, space.id, args.userId)

    return { inviteCode: await rotateInviteCode(ctx, space) }
  },
})

async function scheduleUnassign(
  ctx: MutationCtx,
  appSpaceId: string,
  assigneeId: string,
) {
  await ctx.scheduler.runAfter(0, internal.spaces.continueUnassign, {
    appSpaceId,
    assigneeId,
  })
}

export const continueUnassign = internalMutation({
  args: { appSpaceId: v.string(), assigneeId: v.string() },
  handler: async (ctx, args) => {
    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_space_assignee', (q) =>
        q.eq('spaceId', args.appSpaceId).eq('assigneeId', args.assigneeId),
      )
      .take(UNASSIGN_BATCH)
    for (const task of tasks) {
      await ctx.db.patch(task._id, { assigneeId: null })
    }
    if (tasks.length === UNASSIGN_BATCH)
      await ctx.scheduler.runAfter(0, internal.spaces.continueUnassign, args)
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

    await runDeleteCascade(ctx, { spaceId: space._id, phase: 'projects' })
  },
})

const DELETE_PHASES = ['projects', 'activity', 'tasks', 'members'] as const
type DeletePhase = (typeof DELETE_PHASES)[number]

const DELETE_BATCH = 100

const UNASSIGN_BATCH = 100

async function deleteSpacePhase(
  ctx: MutationCtx,
  next: { spaceId: string; phase: DeletePhase },
): Promise<PhaseOutcome> {
  const space = await ctx.db.get(next.spaceId as Doc<'spaces'>['_id'])
  if (!space) return 'gone'

  const drained = await deleteTablePage(ctx, next.phase, space.id)
  if (!drained) return next.phase
  const following = DELETE_PHASES[DELETE_PHASES.indexOf(next.phase) + 1]
  return following ?? 'drained'
}

type PhaseOutcome = DeletePhase | 'gone' | 'drained'

async function deleteTablePage(
  ctx: MutationCtx,
  phase: DeletePhase,
  appSpaceId: string,
): Promise<boolean> {
  const rows =
    phase === 'activity'
      ? await ctx.db
          .query('taskActivity')
          .withIndex('by_space_task', (q) => q.eq('spaceId', appSpaceId))
          .take(DELETE_BATCH)
      : await ctx.db
          .query(TABLE_FOR_PHASE[phase])
          .withIndex('by_space', (q) => q.eq('spaceId', appSpaceId))
          .take(DELETE_BATCH)
  await Promise.all(rows.map((row) => ctx.db.delete(row._id)))
  return rows.length < DELETE_BATCH
}

const TABLE_FOR_PHASE = {
  projects: 'projects',
  tasks: 'tasks',
  members: 'spaceMembers',
} as const satisfies Record<Exclude<DeletePhase, 'activity'>, string>

async function runDeleteCascade(
  ctx: MutationCtx,
  start: { spaceId: string; phase: DeletePhase },
) {
  let next: { spaceId: string; phase: DeletePhase } = start
  for (;;) {
    const outcome = await deleteSpacePhase(ctx, next)
    if (outcome === 'gone') return
    if (outcome === 'drained') break
    if (outcome === next.phase) {
      await ctx.scheduler.runAfter(0, internal.spaces.continueDeleteSpace, next)
      return
    }
    next = { spaceId: start.spaceId, phase: outcome }
  }
  await ctx.db.delete(start.spaceId as Doc<'spaces'>['_id'])
}

export const continueDeleteSpace = internalMutation({
  args: {
    spaceId: v.string(),
    phase: v.union(
      v.literal('projects'),
      v.literal('activity'),
      v.literal('tasks'),
      v.literal('members'),
    ),
  },
  handler: async (ctx, args) => {
    await runDeleteCascade(ctx, args)
  },
})
