import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'

import { SPACES_ENABLED } from '#/feature-flags'
import { mySpacesQueryOptions } from '#/spaces/queries'
import { boardQueryOptions } from '#/tracker/queries'

import type { QueryClient } from '@tanstack/react-query'
import type { AnyRouter } from '@tanstack/react-router'

const WARM_SPACE_BOARDS = 3

const ignore = () => {}

type SpaceRow = { id: string }

interface WarmClients {
  router: Pick<AnyRouter, 'preloadRoute'>
  queryClient: Pick<QueryClient, 'ensureQueryData' | 'prefetchQuery'>
}

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

function whenIdle(task: () => void) {
  if (typeof window === 'undefined') return
  const requestIdle = window.requestIdleCallback?.bind(window)
  if (!requestIdle) {
    window.setTimeout(task, 0)
    return
  }
  requestIdle(task, { timeout: 2000 })
}

export function usePrefetchRoutes() {
  const router = useRouter()
  const queryClient = useQueryClient()

  useEffect(() => {
    whenIdle(() => warmRoutes({ router, queryClient }))
  }, [router, queryClient])
}
