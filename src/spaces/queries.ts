import { useMutation, useQuery } from '@tanstack/react-query'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'

import { api } from '../../convex/_generated/api'

/** Reactive query — live sync across tabs/devices. Spaces come from Convex
 *  only: a space that is not on the server does not exist, and a local
 *  fallback would invent both its id and its invite code. */
export const mySpacesQueryOptions = convexQuery(api.spaces.getMySpaces, {})

export function spaceMembersQueryOptions(spaceId: string | null) {
  return convexQuery(api.spaces.getSpaceMembers, spaceId ? { spaceId } : 'skip')
}

export function useSpaceMembers(spaceId: string | null) {
  const { data } = useQuery({
    ...spaceMembersQueryOptions(spaceId),
    enabled: !!spaceId,
  })
  return data
}

/** Create a collaborative space. The server generates the id and the invite
 *  code, so there is nothing to reconcile afterwards and no optimistic
 *  placeholder to invent. */
export function useCreateSpace() {
  return useMutation({ mutationFn: useConvexMutation(api.spaces.createSpace) })
}

export function useJoinSpace() {
  return useMutation({
    mutationFn: useConvexMutation(api.spaces.joinSpaceByCode),
  })
}

export function useLeaveSpace() {
  return useMutation({ mutationFn: useConvexMutation(api.spaces.leaveSpace) })
}

export function useDeleteSpace() {
  return useMutation({ mutationFn: useConvexMutation(api.spaces.deleteSpace) })
}

/** Issue a new invite link for a space. Owner only, enforced on the server. */
export function useResetInviteCode() {
  return useMutation({
    mutationFn: useConvexMutation(api.spaces.resetInviteCode),
  })
}

/** Take one person's access away and rotate the link, in one transaction. */
export function useRemoveMember() {
  return useMutation({ mutationFn: useConvexMutation(api.spaces.removeMember) })
}

export function useSyncUserProfile() {
  return useMutation({
    mutationFn: useConvexMutation(api.spaces.syncUserProfile),
  })
}
