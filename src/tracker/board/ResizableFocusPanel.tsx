import type * as React from 'react'

import { useLocalNumber } from '#/design-system'
import { FocusPanel } from '../focus/FocusPanel'

import type { BoardData } from '../types'

export function ResizableFocusPanel({
  board,
  onClose,
}: {
  board: BoardData
  onClose: () => void
}) {
  const [focusWidth, setFocusWidth, setFocusWidthLive, commitFocusWidth] =
    useLocalNumber('lifeos-focus-width', 320)

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
