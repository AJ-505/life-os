import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouterState } from '@tanstack/react-router'
import * as z from 'zod'

import { jsonCodec, storedValue, useStored } from '#/design-system/stored'
import { SPACES_ENABLED } from '#/feature-flags'
import { mySpacesQueryOptions } from '#/spaces/queries'

export type SpacesEntry = { spaceId: string | null }

export type SpacesNavTarget =
  | { to: '/spaces' }
  | { to: '/space/$spaceId'; params: { spaceId: string } }

const storedEntry = z.object({ spaceId: z.string().min(1).nullable() })

const lastSpaces = storedValue<SpacesEntry | null>(
  'lifeos.spaces.last',
  jsonCodec(storedEntry.nullable()),
  null,
)

export const subscribeLastSpaces = lastSpaces.subscribe
export const readLastSpaces = lastSpaces.read
export const writeLastSpaces = (entry: SpacesEntry) => lastSpaces.write(entry)

export function spacesEntryFor(pathname: string): SpacesEntry | null {
  const [, segment, spaceId] = pathname.split('/')
  if (segment === 'spaces') return { spaceId: null }
  if (segment === 'space' && spaceId) return { spaceId }
  return null
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
  const [stored] = useStored(lastSpaces)
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

  return resolveSpacesHref(SPACES_ENABLED ? stored : null, validSpaceIds)
}
