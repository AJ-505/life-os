import { createFileRoute } from '@tanstack/react-router'

import { TimelineView } from '#/tracker'

export const Route = createFileRoute('/timeline')({
  component: TimelineView,
})
