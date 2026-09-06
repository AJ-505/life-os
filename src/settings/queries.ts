import { useMutation } from '@tanstack/react-query'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'

import { api } from '../../convex/_generated/api'

export const calendarSettingsQueryOptions = convexQuery(
  api.settings.getCalendarSettings,
  {},
)

export function useUpdateCalendarSettings() {
  const mutationFn = useConvexMutation(
    api.settings.updateCalendarSettings,
  ).withOptimisticUpdate((store, args) => {
    const prev = store.getQuery(api.settings.getCalendarSettings, {})
    if (!prev) return
    store.setQuery(api.settings.getCalendarSettings, {}, { ...prev, ...args })
  })
  return useMutation({ mutationFn })
}
