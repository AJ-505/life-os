import { describe, expect, it } from 'vitest'

import { warmRoutes } from './prefetch-routes'
import { boardQueryOptions } from '#/tracker/queries'

import type { QueryClient } from '@tanstack/react-query'
import type { AnyRouter } from '@tanstack/react-router'

/**
 * The warm runs off the idle queue after the first route is on screen, so its
 * observable contract is the chain of calls: which route matches, which data,
 * capped where it must be, and silent when the network is not there. That is
 * what these check — with doubles, no browser and no deployment behind them.
 */

interface Preloaded {
  to: string
  params?: Record<string, string>
}

function fakeClients(spaces: Array<{ id: string }>, opts?: { spacesFail?: boolean }) {
  const preloaded: Preloaded[] = []
  const ensured: unknown[] = []
  const prefetched: Array<{ queryKey: unknown[] }> = []

  const router = {
    preloadRoute: (options: Preloaded) => {
      preloaded.push(options)
      return Promise.resolve([])
    },
  }

  const queryClient = {
    ensureQueryData: (options: unknown) => {
      ensured.push(options)
      return opts?.spacesFail
        ? Promise.reject(new Error('not signed in'))
        : Promise.resolve(spaces)
    },
    prefetchQuery: (options: { queryKey: unknown[] }) => {
      prefetched.push(options)
      return Promise.resolve()
    },
  }

  return {
    router: router as unknown as AnyRouter,
    queryClient: queryClient as unknown as QueryClient,
    preloaded,
    ensured,
    prefetched,
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const spacesList = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `space_${i}` }))

describe('warmRoutes', () => {
  it('preloads the shell navigation routes and the spaces list', async () => {
    const c = fakeClients(spacesList(1))

    warmRoutes({ router: c.router, queryClient: c.queryClient })
    await flush()

    expect(c.preloaded.map((p) => p.to)).toEqual([
      '/timeline',
      '/library',
      '/spaces',
      '/space/$spaceId',
    ])
    expect(c.preloaded[3].params).toEqual({ spaceId: 'space_0' })
    // The spaces list resolves through ensureQueryData so its ids can drive the
    // rest of the chain.
    expect(c.ensured).toHaveLength(1)
  })

  it('warms the board data of only the first few spaces', async () => {
    const c = fakeClients(spacesList(9))

    warmRoutes({ router: c.router, queryClient: c.queryClient })
    await flush()

    const boardKeys = c.prefetched.map((q) => JSON.stringify(q.queryKey))
    expect(boardKeys).toEqual([
      JSON.stringify(boardQueryOptions('space_0').queryKey),
      JSON.stringify(boardQueryOptions('space_1').queryKey),
      JSON.stringify(boardQueryOptions('space_2').queryKey),
    ])
  })

  it('does not touch spaces when the flag is off', async () => {
    const c = fakeClients(spacesList(3))

    warmRoutes({ router: c.router, queryClient: c.queryClient, spacesEnabled: false })
    await flush()

    expect(c.preloaded.map((p) => p.to)).toEqual([
      '/timeline',
      '/library',
      '/spaces',
    ])
    expect(c.ensured).toHaveLength(0)
    expect(c.prefetched).toHaveLength(0)
  })

  it('stays silent when the network is not there', async () => {
    const c = fakeClients([], { spacesFail: true })

    warmRoutes({ router: c.router, queryClient: c.queryClient })

    // A rejection here would surface as an unhandled rejection and fail the run.
    await flush()
    expect(c.ensured).toHaveLength(1)
  })

  it('skips the space chain when the user has no spaces', async () => {
    const c = fakeClients([])

    warmRoutes({ router: c.router, queryClient: c.queryClient })
    await flush()

    expect(c.preloaded.map((p) => p.to)).toEqual([
      '/timeline',
      '/library',
      '/spaces',
    ])
    expect(c.prefetched).toHaveLength(0)
  })
})
