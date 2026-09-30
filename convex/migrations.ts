import { v } from 'convex/values'

import { internalMutation, internalQuery } from './_generated/server'
import { internal } from './_generated/api'

/**
 * Backfills for rows written before schema changes. Each pass is bounded and
 * self-continuing: it re-schedules itself from the batch cursor until a table
 * has no more matching rows, so one deployment can finish the migration over
 * many transactions without blocking regular traffic.
 *
 * Run once via `npx convex run internal.migrations.backfillSpaceId` — it
 * schedules its own continuations from there.
 */

/** Rows written before `spaceId` was `null`-normalized carry no value at all,
 *  and a missing indexed field keeps the row out of `by_user_space`. The field
 *  stays optional in the schema until this pass has run everywhere.
 *
 *  Convex allows only ONE paginated query per function, so the two tables run
 *  as separate phases: tasks drain first, then the same pattern repeats for
 *  projects. */
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
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillSpaceId,
        { phase: args.phase, cursor: page.continueCursor },
      )
      return
    }
    // Tasks drained: move on to projects. Projects drained: done.
    if (args.phase === 'tasks') {
      await ctx.scheduler.runAfter(0, internal.migrations.backfillSpaceId, {
        phase: 'projects',
        cursor: null,
      })
    }
  },
})

/** Proves the invariant the backfill exists to establish: every row carries
 *  `spaceId` (a space id or `null`), so no row is invisible to `by_user_space`.
 *
 *  Read-only and one-shot, unlike the backfill: a query has no transaction
 *  write budget, so it can scan both tables whole. A row is "missing" when the
 *  field is absent (`spaceId` is not a key). `count` counts only the missing
 *  ones, so `count: 0` on both tables is the green light to tighten the schema
 *  back to a required union.
 *
 *  Run: `npx convex run internal.migrations.verifySpaceId` (add `--prod` for
 *  the production deployment). */
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
