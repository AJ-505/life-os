import { useMutation, useQuery } from '@tanstack/react-query'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'

import { api } from '../../convex/_generated/api'

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

export function useResetInviteCode() {
  return useMutation({
    mutationFn: useConvexMutation(api.spaces.resetInviteCode),
  })
}

export function useRemoveMember() {
  return useMutation({ mutationFn: useConvexMutation(api.spaces.removeMember) })
}

export function useSyncUserProfile() {
  return useMutation({
    mutationFn: useConvexMutation(api.spaces.syncUserProfile),
  })
}
