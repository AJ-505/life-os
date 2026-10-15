import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'

import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob([
  './**/*.ts',
  '!./**/*.test.ts',
  '!./test.setup.ts',
])

describe('release', () => {
  it('reports nothing before the first publish', async () => {
    const t = convexTest(schema, modules)
    expect(await t.query(api.release.current)).toBeNull()
  })

  it('serves the latest published build without a login', async () => {
    const t = convexTest(schema, modules)
    await t.mutation(internal.release.publish, { buildId: 'aaa' })
    await t.mutation(internal.release.publish, { buildId: 'bbb' })
    expect(await t.query(api.release.current)).toBe('bbb')
  })

  it('keeps one row and ignores a repeated publish', async () => {
    const t = convexTest(schema, modules)
    expect(await t.mutation(internal.release.publish, { buildId: 'aaa' })).toBe(
      true,
    )
    expect(await t.mutation(internal.release.publish, { buildId: 'aaa' })).toBe(
      false,
    )
    await t.mutation(internal.release.publish, { buildId: 'bbb' })
    const rows = await t.run((ctx) => ctx.db.query('releases').collect())
    expect(rows).toHaveLength(1)
  })
})
