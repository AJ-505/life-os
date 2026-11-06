import { useEffect, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouterState } from '@tanstack/react-router'
import * as z from 'zod'

import { SPACES_ENABLED } from '#/feature-flags'
import { mySpacesQueryOptions } from '#/spaces/queries'

export type SpacesEntry = { spaceId: string | null }

export type SpacesNavTarget =
  | { to: '/spaces' }
  | { to: '/space/$spaceId'; params: { spaceId: string } }

const LAST_SPACES_KEY = 'lifeos.spaces.last'

const storedEntry = z.object({ spaceId: z.string().min(1).nullable() })

const listeners = new Set<() => void>()

function rawSnapshot(): string | null {
  try {
    return localStorage.getItem(LAST_SPACES_KEY)
  } catch {
    return null
  }
}

export function subscribeLastSpaces(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === LAST_SPACES_KEY) listener()
  }
  listeners.add(listener)
  globalThis.addEventListener?.('storage', onStorage)
  return () => {
    listeners.delete(listener)
    globalThis.removeEventListener?.('storage', onStorage)
  }
}

const serverSnapshot = () => null

export function spacesEntryFor(pathname: string): SpacesEntry | null {
  const [, segment, spaceId] = pathname.split('/')
  if (segment === 'spaces') return { spaceId: null }
  if (segment === 'space' && spaceId) return { spaceId }
  return null
}

export function parseLastSpaces(raw: string | null): SpacesEntry | null {
  if (raw === null) return null
  try {
    const parsed = storedEntry.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function readLastSpaces(): SpacesEntry | null {
  return parseLastSpaces(rawSnapshot())
}

export function writeLastSpaces(entry: SpacesEntry) {
  const raw = JSON.stringify(entry)
  if (raw === rawSnapshot()) return
  try {
    localStorage.setItem(LAST_SPACES_KEY, raw)
  } catch {
    return
  }
  for (const listener of listeners) listener()
}

export function resolveSpacesHref(
  stored: SpacesEntry | null,
  validSpaceIds: readonly string[] | undefined,
): SpacesNavTarget {
  const spaceId = stored?.spaceId
  if (!spaceId) return { to: '/spaces' }
  if (validSpaceIds !== undefined && !validSpaceIds.includes(spaceId)) {
    return { to: '/spaces' }
  }
  return { to: '/space/$spaceId', params: { spaceId } }
}

export function useSpacesNavTarget(): SpacesNavTarget {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const raw = useSyncExternalStore(
    subscribeLastSpaces,
    rawSnapshot,
    serverSnapshot,
  )
  const { data, isPending } = useQuery({
    ...mySpacesQueryOptions,
    enabled: SPACES_ENABLED,
  })

  useEffect(() => {
    const entry = spacesEntryFor(pathname)
    if (entry) writeLastSpaces(entry)
  }, [pathname])

  const validSpaceIds = isPending
    ? undefined
    : (data ?? []).map((space) => space.id)

  return resolveSpacesHref(
    SPACES_ENABLED ? parseLastSpaces(raw) : null,
    validSpaceIds,
  )
}
