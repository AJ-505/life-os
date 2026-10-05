import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'

import { api, internal } from './_generated/api'
import schema from './schema'

/**
 * The `spaceId` backfill contract, from the 2026-10-03 audit.
 *
 * Personal reads use `eq('spaceId', null)` through `by_user_space`. Convex
 * omits a document from an index when the indexed field is absent, so a row
 * written before the field existed is invisible until `backfillSpaceId` runs.
 * This test pins that contract: it is the reason the migration is a deploy
 * step, not a nice-to-have.
 */

const modules = import.meta.glob([
  './**/*.ts',
  '!./**/*.test.ts',
  '!./test.setup.ts',
])

describe('spaceId backfill', () => {
  it('makes a pre-space personal row visible to getBoard', async () => {
    const t = convexTest(schema, modules)

    // Rows exactly as the pre-space code wrote them: no `spaceId` key at all.
    await t.run(async (ctx) => {
      await ctx.db.insert('projects', {
        userId: 'user_a',
        id: 'p1',
        name: 'Old project',
        color: 'moss',
        status: 'active',
        collapsed: false,
        gridCol: 0,
        gridRow: 0,
        targetDate: null,
        createdAt: 1,
        finishedAt: null,
        shelvedAt: null,
      })
      await ctx.db.insert('tasks', {
        userId: 'user_a',
        id: 't1',
        projectId: 'p1',
        parentId: null,
        title: 'Old task',
        notes: null,
        position: 1,
        done: false,
        doneAt: null,
        archived: false,
        dueAt: null,
        inFocus: false,
        focusOrder: 0,
        createdAt: 1,
      })
    })

    const user = t.withIdentity({ subject: 'user_a' })
    expect(
      await user.query(api.tracker.getBoard, { spaceId: null }),
    ).toHaveLength(0)

    await t.mutation(internal.migrations.backfillSpaceId, { phase: 'tasks' })
    await t.mutation(internal.migrations.backfillSpaceId, { phase: 'projects' })

    expect(
      await user.query(api.tracker.getBoard, { spaceId: null }),
    ).toHaveLength(1)
  })
})
