import { useEffect } from 'react'
import { useQuery } from 'convex/react'
import { toast } from 'sonner'

import { api } from '../../convex/_generated/api'
import {
  BUILD_ID,
  isUpdateAvailable,
  markReleaseSeen,
  readSeenRelease,
} from './update-check'

const TOAST_ID = 'app-update'

export function UpdateNotifier() {
  const published = useQuery(api.release.current)

  useEffect(() => {
    if (!published) return
    if (!isUpdateAvailable(BUILD_ID, published, readSeenRelease())) {
      toast.dismiss(TOAST_ID)
      return
    }
    toast('A new version of Life OS is ready', {
      id: TOAST_ID,
      duration: Infinity,
      action: {
        label: 'Refresh',
        onClick: () => {
          markReleaseSeen(published)
          location.reload()
        },
      },
      onDismiss: () => markReleaseSeen(published),
    })
  }, [published])

  return null
}
