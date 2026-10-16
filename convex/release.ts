import { v } from 'convex/values'

import { internalMutation, query } from './_generated/server'

export const current = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query('releases').order('desc').first()
    return row?.buildId ?? null
  },
})

export const latest = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query('releases').order('desc').first()
    return row ? { buildId: row.buildId, publishedAt: row.publishedAt } : null
  },
})

export const publish = internalMutation({
  args: { buildId: v.string() },
  handler: async (ctx, { buildId }) => {
    const row = await ctx.db.query('releases').order('desc').first()
    if (row?.buildId === buildId) return false
    if (row) {
      await ctx.db.patch('releases', row._id, {
        buildId,
        publishedAt: Date.now(),
      })
    } else {
      await ctx.db.insert('releases', { buildId, publishedAt: Date.now() })
    }
    return true
  },
})
