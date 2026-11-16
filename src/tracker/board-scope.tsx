import { createContext, useContext, type ReactNode } from 'react'

const BoardScopeContext = createContext<string | null>(null)

export function BoardScopeProvider({
  spaceId,
  children,
}: {
  spaceId: string | null
  children: ReactNode
}) {
  return (
    <BoardScopeContext.Provider value={spaceId}>
      {children}
    </BoardScopeContext.Provider>
  )
}

export function useBoardScope(): string | null {
  return useContext(BoardScopeContext)
}
