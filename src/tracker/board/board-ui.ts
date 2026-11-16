import { createContext, useContext } from 'react'

export type BoardUIApi = {
  openTask: (id: string) => void
  setHovered: (id: string | null) => void
}

const noop = () => {}

export const BoardUIContext = createContext<BoardUIApi>({
  openTask: noop,
  setHovered: noop,
})

export function useBoardUI() {
  return useContext(BoardUIContext)
}
