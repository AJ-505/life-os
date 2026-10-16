import { useEffect, useState } from 'react'
import { useQuery } from 'convex/react'
import { toast } from 'sonner'

import { api } from '../../convex/_generated/api'
import {
  BUILD_ID,
  isUpdateAvailable,
  markReleaseSeen,
  msUntilLive,
  readSeenRelease,
} from './update-check'

const TOAST_ID = 'app-update'

export function UpdateNotifier() {
  const release = useQuery(api.release.latest, BUILD_ID ? {} : 'skip')
  const [live, setLive] = useState<string | null>(null)

  useEffect(() => {
    if (!release) return
    const id = window.setTimeout(
      () => setLive(release.buildId),
      msUntilLive(release.publishedAt, Date.now()),
    )
    return () => window.clearTimeout(id)
  }, [release])

  useEffect(() => {
    if (!live) return
    if (!isUpdateAvailable(BUILD_ID, live, readSeenRelease())) {
      toast.dismiss(TOAST_ID)
      return
    }
    toast('A new version of Life OS is ready', {
      id: TOAST_ID,
      duration: Infinity,
      action: {
        label: 'Refresh',
        onClick: () => {
          markReleaseSeen(live)
          location.reload()
        },
      },
      onDismiss: () => markReleaseSeen(live),
    })
  }, [live])

  return null
}
