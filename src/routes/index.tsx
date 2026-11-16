import { createFileRoute } from '@tanstack/react-router'

import { BoardView } from '#/tracker/board/BoardView'
import { BoardScopeProvider } from '#/tracker/board-scope'
import { boardSearch } from '#/tracker/board/board-search'

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
