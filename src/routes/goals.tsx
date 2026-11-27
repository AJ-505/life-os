import { createFileRoute } from '@tanstack/react-router'

import { GoalsView } from '#/goals/GoalsView'

export const Route = createFileRoute('/goals')({
  component: GoalsView,
})
