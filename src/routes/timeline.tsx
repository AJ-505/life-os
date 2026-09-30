import { createFileRoute } from '@tanstack/react-router'

import { TimelineView } from '#/tracker/timeline/TimelineView'

export const Route = createFileRoute('/timeline')({
  component: TimelineView,
})
