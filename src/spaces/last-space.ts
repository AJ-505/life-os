import { useEffect, useState } from 'react'
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

export function spacesEntryFor(pathname: string): SpacesEntry | null {
  const [, segment, spaceId] = pathname.split('/')
  if (segment === 'spaces') return { spaceId: null }
  if (segment === 'space' && spaceId) return { spaceId }
  return null
}

export function readLastSpaces(): SpacesEntry | null {
  try {
    const raw = localStorage.getItem(LAST_SPACES_KEY)
    if (raw === null) return null
    const parsed = storedEntry.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function writeLastSpaces(entry: SpacesEntry) {
  try {
    localStorage.setItem(LAST_SPACES_KEY, JSON.stringify(entry))
  } catch {
    return
  }
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
  const [stored, setStored] = useState<SpacesEntry | null>(null)
  const { data, isPending } = useQuery({
    ...mySpacesQueryOptions,
    enabled: SPACES_ENABLED,
  })

  useEffect(() => {
    const entry = spacesEntryFor(pathname)
    if (entry) writeLastSpaces(entry)
    setStored(readLastSpaces())
  }, [pathname])

  const validSpaceIds = isPending
    ? undefined
    : (data ?? []).map((space) => space.id)

  return resolveSpacesHref(SPACES_ENABLED ? stored : null, validSpaceIds)
}
