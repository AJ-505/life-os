export const BUILD_ID: string = import.meta.env.VITE_BUILD_ID ?? ''

const SEEN_KEY = 'lifeos:seen-release'

export const GO_LIVE_MS = 60_000

export function msUntilLive(publishedAt: number, now: number) {
  return Math.max(0, publishedAt + GO_LIVE_MS - now)
}

export function isUpdateAvailable(
  running: string,
  published: string | null | undefined,
  seen: string | null,
) {
  if (!running || !published) return false
  return published !== running && published !== seen
}

export function readSeenRelease() {
  return sessionStorage.getItem(SEEN_KEY)
}

export function markReleaseSeen(buildId: string) {
  sessionStorage.setItem(SEEN_KEY, buildId)
}
