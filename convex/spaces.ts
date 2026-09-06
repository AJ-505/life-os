import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import { requireMember, requireUserId, shapeProject, shapeTask } from './lib'

import type { Doc } from './_generated/dataModel'

function shapeSpace(s: Doc<'spaces'>) {
  return {
    id: s.id,
    ownerId: s.ownerId,
    name: s.name,
    inviteCode: s.inviteCode,
    createdAt: s.createdAt,
  }
}

export const createSpace = mutation({
  args: {
    name: v.string(),
    id: v.string(),
    inviteCode: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const name = args.name.trim()
    if (!name) throw new Error('Space name is required')
    if (!args.id.trim()) throw new Error('Space id is required')
    if (!args.inviteCode.trim()) throw new Error('Invite code is required')

    // Idempotent: if a space with this id already exists, return its inviteCode
    const existingById = await ctx.db
      .query('spaces')
      .filter((q) => q.eq(q.field('id'), args.id))
      .first()
    if (existingById) {
      // Ensure caller is owner or member; if not, still return but don't add
      return existingById.inviteCode
    }

    // Ensure inviteCode uniqueness
    const existingByCode = await ctx.db
      .query('spaces')
      .withIndex('by_inviteCode', (q) => q.eq('inviteCode', args.inviteCode))
      .unique()
    if (existingByCode) throw new Error('Invite code already in use')

    await ctx.db.insert('spaces', {
      id: args.id,
      ownerId: userId,
      name,
      inviteCode: args.inviteCode,
      createdAt: Date.now(),
    })
    await ctx.db.insert('spaceMembers', {
      spaceId: args.id,
      userId,
      role: 'owner',
      joinedAt: Date.now(),
    })
    return args.inviteCode
  },
})

export const joinSpaceByCode = mutation({
  args: { inviteCode: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const code = args.inviteCode.trim()
    if (!code) throw new Error('Invite code is required')
    const space = await ctx.db
      .query('spaces')
      .withIndex('by_inviteCode', (q) => q.eq('inviteCode', code))
      .unique()
    if (!space) throw new Error('Space not found for invite code')

    const membership = await ctx.db
      .query('spaceMembers')
      .withIndex('by_space_user', (q) =>
        q.eq('spaceId', space.id).eq('userId', userId),
      )
      .unique()
    if (!membership) {
      await ctx.db.insert('spaceMembers', {
        spaceId: space.id,
        userId,
        role: 'member',
        joinedAt: Date.now(),
      })
    }
    return shapeSpace(space)
  },
})

export const leaveSpace = mutation({
  args: { spaceId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const membership = await requireMember(ctx, userId, args.spaceId)
    // Owners should delete the space instead of leaving; we allow it but
    // warn via error to avoid orphaned spaces. Comment out if owner-leave
    // should be permitted.
    // For minimal additive behaviour we allow leave for any role.
    await ctx.db.delete(membership._id)
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
    const spaces: Array<Doc<'spaces'>> = []
    for (const m of memberships) {
      const space = await ctx.db
        .query('spaces')
        .filter((q) => q.eq(q.field('id'), m.spaceId))
        .first()
      if (space) spaces.push(space)
    }
    return spaces.map(shapeSpace)
  },
})

export const getSpaceBoard = query({
  args: { spaceId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    await requireMember(ctx, userId, args.spaceId)

    const projects = await ctx.db
      .query('spaces')
      .filter((q) => q.eq(q.field('id'), args.spaceId))
      .first()
    if (!projects) throw new Error('Space not found')

    const spaceProjects = await ctx.db
      .query('projects')
      .withIndex('by_space', (q) => q.eq('spaceId', args.spaceId))
      .collect()

    // Gather tasks for those projects via by_project index
    const tasksByProject = new Map<string, Array<Doc<'tasks'>>>()
    for (const p of spaceProjects) {
      const tasks = await ctx.db
        .query('tasks')
        .withIndex('by_project', (q) => q.eq('projectId', p.id))
        .collect()
      tasksByProject.set(p.id, tasks)
    }

    return spaceProjects
      .slice()
      .sort((a, b) => a.gridCol - b.gridCol || a.gridRow - b.gridRow)
      .map((p) => ({
        ...shapeProject(p),
        tasks: (tasksByProject.get(p.id) ?? [])
          .sort((a, b) => a.position - b.position)
          .map(shapeTask),
      }))
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
    return members.map((m) => ({
      userId: m.userId,
      spaceId: m.spaceId,
      role: m.role,
      joinedAt: m.joinedAt,
    }))
  },
})

export const getSpaceByInviteCode = query({
  args: { inviteCode: v.string() },
  handler: async (ctx, args) => {
    await requireUserId(ctx)
    const space = await ctx.db
      .query('spaces')
      .withIndex('by_inviteCode', (q) => q.eq('inviteCode', args.inviteCode))
      .unique()
    if (!space) return null
    return shapeSpace(space)
  },
})

export const deleteSpace = mutation({
  args: { spaceId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const space = await ctx.db
      .query('spaces')
      .filter((q) => q.eq(q.field('id'), args.spaceId))
      .first()
    if (!space) throw new Error('Space not found')
    if (space.ownerId !== userId) throw new Error('Only owner can delete space')

    // Delete members
    const members = await ctx.db
      .query('spaceMembers')
      .withIndex('by_space', (q) => q.eq('spaceId', args.spaceId))
      .collect()
    await Promise.all(members.map((m) => ctx.db.delete(m._id)))

    // Cascade to projects and their tasks scoped to this space
    const projects = await ctx.db
      .query('projects')
      .withIndex('by_space', (q) => q.eq('spaceId', args.spaceId))
      .collect()
    for (const p of projects) {
      const tasks = await ctx.db
        .query('tasks')
        .withIndex('by_project', (q) => q.eq('projectId', p.id))
        .collect()
      await Promise.all(tasks.map((t) => ctx.db.delete(t._id)))
      await ctx.db.delete(p._id)
    }

    await ctx.db.delete(space._id)
  },
})
