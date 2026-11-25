import { createContext, useContext, type ReactNode } from 'react'

export type BoardScope = {
  spaceId: string | null
  can: {
    focus: boolean
    calendar: boolean
    importEvents: boolean
    assign: boolean
    history: boolean
  }
}

export function boardScope(spaceId: string | null): BoardScope {
  const personal = spaceId === null
  return {
    spaceId,
    can: {
      focus: personal,
      calendar: personal,
      importEvents: personal,
      assign: !personal,
      history: !personal,
    },
  }
}

const PERSONAL = boardScope(null)

const BoardScopeContext = createContext<BoardScope>(PERSONAL)

export function BoardScopeProvider({
  spaceId,
  children,
}: {
  spaceId: string | null
  children: ReactNode
}) {
  return (
    <BoardScopeContext.Provider value={boardScope(spaceId)}>
      {children}
    </BoardScopeContext.Provider>
  )
}

export function useBoardScope(): BoardScope {
  return useContext(BoardScopeContext)
}
