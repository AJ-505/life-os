import { createFileRoute } from '@tanstack/react-router'

import { LibraryView } from '#/tracker'

export const Route = createFileRoute('/library')({
  component: LibraryView,
})
