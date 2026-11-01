import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ShieldOff } from 'lucide-react'

import { Button } from '#/design-system/ui/button'
import { BoardView } from '#/tracker/board/BoardView'
import { BoardScopeProvider } from '#/tracker/board-scope'
import { boardQueryOptions } from '#/tracker/queries'
import { boardSearch } from '#/tracker/board/board-search'

export const Route = createFileRoute('/space/$spaceId')({
  component: SpaceBoard,
  validateSearch: boardSearch,
  errorComponent: SpaceUnavailable,
})

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
  const { view } = Route.useSearch()
  const { isError } = useQuery({ ...boardQueryOptions(spaceId), retry: false })

  if (isError) return <SpaceUnavailable />

  return (
    <BoardScopeProvider spaceId={spaceId}>
      <BoardView spaceId={spaceId} view={view ?? 'board'} />
    </BoardScopeProvider>
  )
}
