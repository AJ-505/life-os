import { createFileRoute } from '@tanstack/react-router'

import { BoardView } from '#/tracker'
import { BoardScopeProvider } from '#/tracker/board-scope'

/**
 * A shared board. The scope comes from the URL, which is the point: a space
 * board is a thing you send to someone, so it needs a real path rather than a
 * query string on the personal board.
 */
export const Route = createFileRoute('/space/$spaceId')({
  component: SpaceBoard,
})

function SpaceBoard() {
  const { spaceId } = Route.useParams()
  return (
    <BoardScopeProvider spaceId={spaceId}>
      <BoardView spaceId={spaceId} />
    </BoardScopeProvider>
  )
}
