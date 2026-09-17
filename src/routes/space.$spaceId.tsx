import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ShieldOff } from 'lucide-react'

import { Button } from '#/design-system/ui/button'
import { BoardView } from '#/tracker'
import { BoardScopeProvider } from '#/tracker/board-scope'
import { boardQueryOptions } from '#/tracker/queries'

/**
 * A shared board. The scope comes from the URL, which is the point: a space
 * board is a thing you send to someone, so it needs a real path rather than a
 * query string on the personal board.
 */
export const Route = createFileRoute('/space/$spaceId')({
  component: SpaceBoard,
  // Two triggers for one panel, because the two cases fail differently. A cold
  // load with no membership throws out of the board's suspense query and lands
  // here. A membership revoked while the board is open fails a background
  // refetch, which a suspense query does not rethrow, so `SpaceBoard` watches
  // for it above.
  errorComponent: SpaceUnavailable,
})

/**
 * Access can be taken away while you are looking at the board. The board query
 * is reactive, so the revoked member's client keeps the last successful result
 * and the rejected refetch is only stored: `useSuspenseQuery` does not rethrow
 * once it has data. Watching the same query here and rendering this panel is
 * what turns "the board is still on screen but nothing saves" into an
 * explanation. The same key means one subscription, not two.
 */
function SpaceUnavailable() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center">
        <ShieldOff className="size-6 text-muted-foreground/60" />
        <h1 className="text-base font-semibold">You are not in this space</h1>
        <p className="text-sm text-muted-foreground">
          Your access ended. If that was not expected, ask the owner for a new
          invite link. Anyone already in the space keeps their access.
        </p>
        <Link to="/spaces" className="no-underline">
          <Button size="sm" variant="outline">
            See your spaces
          </Button>
        </Link>
      </div>
    </div>
  )
}

function SpaceBoard() {
  const { spaceId } = Route.useParams()
  // `useSuspenseQuery` forces its own `throwOnError`, and a reactive query keeps
  // its last data on a failed refetch, so a rejected board subscription never
  // reaches a route error boundary. This plain query exposes the error state.
  const { isError } = useQuery({ ...boardQueryOptions(spaceId), retry: false })

  if (isError) return <SpaceUnavailable />

  return (
    <BoardScopeProvider spaceId={spaceId}>
      <BoardView spaceId={spaceId} />
    </BoardScopeProvider>
  )
}
