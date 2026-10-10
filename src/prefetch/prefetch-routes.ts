import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'

import { SPACES_ENABLED } from '#/feature-flags'
import { mySpacesQueryOptions } from '#/spaces/queries'
import { boardQueryOptions } from '#/tracker/queries'

import type { QueryClient } from '@tanstack/react-query'
import type { AnyRouter } from '@tanstack/react-router'

/**
 * Timeline and Library read the same board query the home board is already
 * watching, so warming those two is their route match alone. The Spaces page
 * also needs its list to render, and a space board needs that space's query —
 * which takes an id only the list can give, so that chain starts from the list.
 * `/join/<code>` and `/sso-callback` are signed-out flows with no shell to
 * mount this from, and their params are unknowable up front.
 */
const WARM_SPACE_BOARDS = 3

const ignore = () => {}

/** A space board, kept warm for as long as it lives in the cache. The cap is
 *  what keeps a member of many spaces from opening one live watch per space in
 *  a single tick; past it, hovering a card warms that board instead. */
type SpaceRow = { id: string }

/**
 * What warming needs from the router and the query cache. The real instances
 * satisfy both; so does a test double, which is what lets the chain be checked
 * without a browser or a deployment behind it.
 */
interface WarmClients {
  router: Pick<AnyRouter, 'preloadRoute'>
  queryClient: Pick<QueryClient, 'ensureQueryData' | 'prefetchQuery'>
}

/**
 * Warms every route the shell navigation can land on, so a click after the
 * first paint renders from cache instead of waiting on the network: route
 * matches through the router (code and `beforeLoad`), and the query data
 * behind each one. Failures are swallowed by design — a warm route is an
 * optimization, and an unhandled rejection here would only make noise.
 */
export function warmRoutes({
  router,
  queryClient,
  spacesEnabled = SPACES_ENABLED,
}: WarmClients & { spacesEnabled?: boolean }) {
  void router.preloadRoute({ to: '/timeline' }).catch(ignore)
  void router.preloadRoute({ to: '/library' }).catch(ignore)
  void router.preloadRoute({ to: '/spaces' }).catch(ignore)

  if (!spacesEnabled) return

  void queryClient
    .ensureQueryData(mySpacesQueryOptions)
    .then((spaces) => {
      const warmIds: string[] = spaces
        .slice(0, WARM_SPACE_BOARDS)
        .map((space: SpaceRow) => space.id)
      if (warmIds.length === 0) return

      // The route match is one module for every id, so warming it for the
      // first space warms it for the rest.
      void router
        .preloadRoute({
          to: '/space/$spaceId',
          params: { spaceId: warmIds[0] },
        })
        .catch(ignore)

      for (const spaceId of warmIds) {
        void queryClient.prefetchQuery(boardQueryOptions(spaceId))
      }
    })
    .catch(ignore)
}

/** Runs on the main thread's first idle turn, so none of this can delay the
 *  route already on screen. The timeout is the ceiling: idle can stay busy a
 *  long while on a slow device, and a route that lands warm late is still
 *  ahead of one that never lands. */
function whenIdle(task: () => void) {
  if (typeof window === 'undefined') return
  const requestIdle = window.requestIdleCallback?.bind(window)
  if (!requestIdle) {
    window.setTimeout(task, 0)
    return
  }
  requestIdle(task, { timeout: 2000 })
}

/**
 * Mounts the background warm once per shell mount. The shell survives
 * navigation, so the whole attempt lands after the first route is on screen
 * and never re-runs behind the user's back.
 */
export function usePrefetchRoutes() {
  const router = useRouter()
  const queryClient = useQueryClient()

  useEffect(() => {
    whenIdle(() => warmRoutes({ router, queryClient }))
  }, [router, queryClient])
}
