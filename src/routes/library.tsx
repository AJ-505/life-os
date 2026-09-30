import { createFileRoute } from '@tanstack/react-router'

import { LibraryView } from '#/tracker/library/LibraryView'

export const Route = createFileRoute('/library')({
  component: LibraryView,
})
