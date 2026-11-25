import { createContext, useContext, type ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { toast } from 'sonner'

import { api } from '../../../convex/_generated/api'
import { useBoardScope } from '../board-scope'
import { pickProject } from './calendar-logic'

type LastProject = {
  chosen: string | null
  choose: (projectId: string) => void
}

const LastProjectContext = createContext<LastProject | null>(null)

function useStoredLastProject(): LastProject {
  const { spaceId } = useBoardScope()
  const { data } = useQuery(
    convexQuery(api.settings.getLastProject, { spaceId }),
  )
  const mutationFn = useConvexMutation(
    api.settings.setLastProject,
  ).withOptimisticUpdate((store, args) => {
    store.setQuery(
      api.settings.getLastProject,
      { spaceId: args.spaceId },
      args.projectId,
    )
  })
  const remember = useMutation({
    mutationFn,
    onError: (e: unknown) => {
      toast.error('Could not remember that project', {
        description: e instanceof Error ? e.message : String(e),
      })
    },
  })
  const chosen = data ?? null
  return {
    chosen,
    choose: (projectId) => {
      if (projectId === chosen) return
      remember.mutate({ spaceId, projectId })
    },
  }
}

export function LastProjectProvider({ children }: { children: ReactNode }) {
  const lastProject = useStoredLastProject()
  return (
    <LastProjectContext.Provider value={lastProject}>
      {children}
    </LastProjectContext.Provider>
  )
}

export function useHomeProject(projects: Array<{ id: string }>) {
  const lastProject = useContext(LastProjectContext)
  if (!lastProject) throw new Error('useHomeProject needs LastProjectProvider')
  return {
    home: pickProject(lastProject.chosen, projects),
    choose: lastProject.choose,
  }
}
