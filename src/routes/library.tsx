import { createFileRoute } from '@tanstack/react-router'

import { LibraryView, boardQueryOptions } from '#/tracker'

export const Route = createFileRoute('/library')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(boardQueryOptions),
  component: LibraryView,
})
