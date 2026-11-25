import { useMutation, useQuery } from '@tanstack/react-query'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { toast } from 'sonner'

import { api } from '../../convex/_generated/api'

import type { OptimisticLocalStore } from 'convex/browser'

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

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

function withoutSpace(store: OptimisticLocalStore, spaceId: string) {
  const spaces = store.getQuery(api.spaces.getMySpaces, {})
  if (!spaces) return
  store.setQuery(
    api.spaces.getMySpaces,
    {},
    spaces.filter((space) => space.id !== spaceId),
  )
}

export function useLeaveSpace() {
  const mutationFn = useConvexMutation(
    api.spaces.leaveSpace,
  ).withOptimisticUpdate((store, args) => withoutSpace(store, args.spaceId))
  return useMutation({
    mutationFn,
    onError: (error: unknown) => {
      toast.error('Could not leave the space', {
        description: errorText(error),
      })
    },
  })
}

export function useDeleteSpace() {
  const mutationFn = useConvexMutation(
    api.spaces.deleteSpace,
  ).withOptimisticUpdate((store, args) => withoutSpace(store, args.spaceId))
  return useMutation({
    mutationFn,
    onError: (error: unknown) => {
      toast.error('Could not delete the space', {
        description: errorText(error),
      })
    },
  })
}

export function useRemoveMember() {
  const mutationFn = useConvexMutation(
    api.spaces.removeMember,
  ).withOptimisticUpdate((store, args) => {
    const members = store.getQuery(api.spaces.getSpaceMembers, {
      spaceId: args.spaceId,
    })
    if (!members) return
    store.setQuery(
      api.spaces.getSpaceMembers,
      { spaceId: args.spaceId },
      members.filter((member) => member.userId !== args.userId),
    )
  })
  return useMutation({
    mutationFn,
    onError: (error: unknown) => {
      toast.error('Could not remove that member', {
        description: errorText(error),
      })
    },
  })
}
