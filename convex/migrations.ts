import { v } from 'convex/values'

import { internalMutation, internalQuery } from './_generated/server'
import { internal } from './_generated/api'

export const backfillSpaceId = internalMutation({
  args: {
    phase: v.union(v.literal('tasks'), v.literal('projects')),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const table = args.phase
    const page = await ctx.db
      .query(table)
      .withIndex('by_creation_time')
      .paginate({ numItems: 500, cursor: args.cursor ?? null })
    for (const row of page.page) {
      if (row.spaceId === undefined) {
        await ctx.db.patch(row._id, { spaceId: null })
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.backfillSpaceId, {
        phase: args.phase,
        cursor: page.continueCursor,
      })
      return
    }
    if (args.phase === 'tasks') {
      await ctx.scheduler.runAfter(0, internal.migrations.backfillSpaceId, {
        phase: 'projects',
        cursor: null,
      })
    }
  },
})

export const verifySpaceId = internalQuery({
  args: {},
  handler: async (ctx) => {
    const check = async (table: 'tasks' | 'projects') => {
      let count = 0
      let total = 0
      const cursor = ctx.db.query(table).withIndex('by_creation_time')
      for await (const row of cursor) {
        total += 1
        if (row.spaceId === undefined) count += 1
      }
      return { count, total }
    }
    return { tasks: await check('tasks'), projects: await check('projects') }
  },
})
