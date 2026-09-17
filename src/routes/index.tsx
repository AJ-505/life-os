import { createFileRoute } from '@tanstack/react-router'

import { BoardView } from '#/tracker'
import { BoardScopeProvider } from '#/tracker/board-scope'

// The board query is per-user and auth-gated, so it loads client-side inside
// the authenticated boundary (see __root.tsx) rather than in an SSR loader.
// The explicit provider says "personal" once, for the whole subtree.
export const Route = createFileRoute('/')({
  component: PersonalBoard,
})

function PersonalBoard() {
  return (
    <BoardScopeProvider spaceId={null}>
      <BoardView spaceId={null} />
    </BoardScopeProvider>
  )
}
