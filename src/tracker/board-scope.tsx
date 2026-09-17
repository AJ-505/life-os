import { createContext, useContext, type ReactNode } from 'react'

/**
 * The board a component is looking at. `null` is the personal board; anything
 * else is a space the caller is a member of.
 *
 * The query key and every optimistic update read this, so a write from inside a
 * space patches the space's cache entry and never the personal one. It is also
 * the gate for the surfaces that are personal only: focus is one shared boolean
 * on a row, and a calendar event belongs to whoever's Google account pushed it,
 * so both are refused in space scope rather than left to guess.
 *
 * Defaults to `null`, which is what makes the timeline and library views keep
 * working without knowing they are personal.
 */
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
