import { useEffect, useRef } from 'react'
import { createServerFn } from '@tanstack/react-start'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'

/**
 * One id per running server process. When the server is redeployed/restarted
 * this changes, which is our signal that a newer build is live. Cheap and
 * dependency-free — no service worker, no manifest diffing.
 */
const BUILD_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const getBuildId = createServerFn({ method: 'GET' }).handler(() => BUILD_ID)

export function UpdateWatcher() {
  const seen = useRef<string | null>(null)
  const notified = useRef(false)

  const { data } = useQuery({
    queryKey: ['build-id'],
    queryFn: () => getBuildId(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  })

  useEffect(() => {
    if (!data) return
    if (seen.current === null) {
      seen.current = data
      return
    }
    if (data !== seen.current && !notified.current) {
      notified.current = true
      toast('A new version of LifeOS is available.', {
        description: 'Reload to get the latest. Your unsaved changes are kept.',
        duration: Infinity,
        action: {
          label: 'Reload',
          onClick: () => window.location.reload(),
        },
      })
    }
  }, [data])

  return null
}
