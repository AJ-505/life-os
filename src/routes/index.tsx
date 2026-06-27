import { createFileRoute } from '@tanstack/react-router'

import { BoardView } from '#/tracker'

// The board query is per-user and auth-gated, so it loads client-side inside
// the authenticated boundary (see __root.tsx) rather than in an SSR loader.
export const Route = createFileRoute('/')({
  component: BoardView,
})
