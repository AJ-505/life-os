import { createFileRoute } from '@tanstack/react-router'

import { TimelineView, boardQueryOptions } from '#/tracker'

export const Route = createFileRoute('/timeline')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(boardQueryOptions),
  component: TimelineView,
})
