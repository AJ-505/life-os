import { createFileRoute } from '@tanstack/react-router'

import { BoardView, boardQueryOptions } from '#/tracker'

export const Route = createFileRoute('/')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(boardQueryOptions),
  component: BoardView,
})
