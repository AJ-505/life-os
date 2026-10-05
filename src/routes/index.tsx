import { Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { BoardView } from '#/tracker/board/BoardView'
import { BoardFacsimile } from '#/tracker/board/BoardFacsimile'
import { BoardScopeProvider } from '#/tracker/board-scope'

// The board query is per-user and auth-gated, so it loads client-side inside
// the authenticated boundary (see __root.tsx) rather than in an SSR loader.
// The explicit provider says "personal" once, for the whole subtree.
export const Route = createFileRoute('/')({
  component: PersonalBoard,
})

function PersonalBoard() {
  // The boundary sits inside the shell's <main>, so the fallback replaces only
  // the board and the sidebar stays put.
  return (
    <Suspense fallback={<BoardFacsimile spaceId={null} />}>
      <BoardScopeProvider spaceId={null}>
        <BoardView spaceId={null} />
      </BoardScopeProvider>
    </Suspense>
  )
}
