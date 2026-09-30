import type * as React from 'react'

import { useLocalNumber } from '#/design-system'
import { FocusPanel } from '../focus/FocusPanel'

import type { BoardData } from '../types'

/**
 * Desktop focus panel + its resize handle. Owns `focusWidth` so that dragging
 * the resize edge (a `pointermove` per frame at 60Hz) only re-renders this
 * aside — previously the width lived in BoardView and every tick re-rendered
 * the whole board canvas. The React Compiler memoizes the component; no
 * hand-written wrapper here.
 */
export function ResizableFocusPanel({
  board,
  onClose,
}: {
  board: BoardData
  onClose: () => void
}) {
  const [focusWidth, setFocusWidth, setFocusWidthLive, commitFocusWidth] =
    useLocalNumber('lifeos-focus-width', 320)

  // Drag the panel's left edge to resize it. The panel is anchored right, so
  // dragging left (smaller clientX) widens it. The drag itself only moves
  // React state — instant feedback, no storage I/O per tick — and the one
  // localStorage write happens when the pointer is released.
  const startFocusResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = focusWidth
    const max = Math.min(720, window.innerWidth - 360)
    const clamp = (w: number) => Math.max(280, Math.min(max, w))
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev: PointerEvent) =>
      setFocusWidthLive(clamp(startW + (startX - ev.clientX)))
    const onUp = () => {
      commitFocusWidth()
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <aside
      className="relative hidden shrink-0 border-l bg-sidebar/50 lg:block"
      style={{ width: focusWidth }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize focus panel"
        onPointerDown={startFocusResize}
        onDoubleClick={() => setFocusWidth(320)}
        title="Drag to resize · double-click to reset"
        className="group absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize"
      >
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-signal/50" />
      </div>
      <FocusPanel board={board} onClose={onClose} />
    </aside>
  )
}
