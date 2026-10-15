import { createFileRoute } from '@tanstack/react-router'

import { BoardView } from '#/tracker/board/BoardView'
import { BoardScopeProvider } from '#/tracker/board-scope'
import { boardSearch } from '#/tracker/board/board-search'

// The board query is per-user and auth-gated, so it loads client-side inside
// the authenticated boundary (see __root.tsx) rather than in an SSR loader.
// The explicit provider says "personal" once, for the whole subtree.
export const Route = createFileRoute('/')({
  component: PersonalBoard,
  validateSearch: boardSearch,
})

function PersonalBoard() {
  const { view } = Route.useSearch()
  return (
    <BoardScopeProvider spaceId={null}>
      <BoardView spaceId={null} view={view ?? 'board'} />
    </BoardScopeProvider>
  )
}
