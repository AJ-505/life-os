import { useMutation } from '@tanstack/react-query'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useQuery } from 'convex/react'

import { api } from '../../convex/_generated/api'

export type Space = {
  id: string
  ownerId: string
  name: string
  inviteCode: string
  createdAt: number
  memberCount?: number
}

/** Reactive query — live sync across tabs/devices */
export const mySpacesQueryOptions = convexQuery(api.spaces.getMySpaces, {})

export function useMySpaces() {
  // convexQuery provides suspense-compatible options; wrap for convenience
  // Fallback: if backend missing, convexQuery will error — caller handles via ErrorBoundary.
  // We expose a hook that can also be used with useQuery directly.
  return mySpacesQueryOptions
}

/** Create a collaborative space. Optimistic: returned inviteCode immediately. */
export function useCreateSpace() {
  const mutationFn = useConvexMutation(api.spaces.createSpace).withOptimisticUpdate(
    (store, args) => {
      const spaces = store.getQuery(api.spaces.getMySpaces, {})
      if (!spaces) return
      // Optimistic placeholder with temporary inviteCode
      const temp: Space = {
        id: args.id,
        ownerId: 'me',
        name: args.name,
        inviteCode: '------',
        createdAt: Date.now(),
        memberCount: 1,
      }
      if (spaces.some((s) => s.id === args.id)) return
      store.setQuery(api.spaces.getMySpaces, {}, [...spaces, temp])
    },
  )
  return useMutation({ mutationFn })
}

export function useJoinSpace() {
  const mutationFn = useConvexMutation(api.spaces.joinSpaceByCode)
  return useMutation({ mutationFn })
}

export function useSpaceMembers(spaceId: string | null) {
  // Conditional query — when null, skip. Use Convex hook directly.
  // Caller should guard rendering.
  const data = useQuery(api.spaces.getSpaceMembers, spaceId ? { spaceId } : 'skip')
  return data
}
