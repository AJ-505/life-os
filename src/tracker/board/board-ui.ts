import { createContext, useContext } from 'react'

/**
 * Board-wide UI plumbing: one TaskDetails dialog lives at the board level
 * (instead of one per card), and rows report hover so keybindings (E to
 * edit, F to focus, D to done) know which task you mean.
 */
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
