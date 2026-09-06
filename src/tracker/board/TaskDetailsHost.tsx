import { useEffect, useRef, useState } from 'react'

import { useSetTaskFocus } from '../queries'
import { BoardUIContext } from './board-ui'
import { TaskDetails } from './TaskDetails'

import type { BoardData, Task } from '../types'

/**
 * Owns the board-level UI that rows need but the board layout must not
 * re-render for: which task dialog is open, and which task the cursor hovers
 * (for Trello-style `e`/`f` keybindings).
 *
 * Why here and not in BoardView: opening a dialog or moving the mouse used to
 * setState at the board root, re-rendering every column on each hover-key
 * press. State lives here so typing in the dialog or hitting `e`/`f` only
 * re-renders this host + the dialog. BoardView keeps its own drag-only task
 * lookup; duplicating that tiny loop is intentional to keep the two concerns
 * separate.
 */
export function TaskDetailsHost({
  board,
  onToggleFocus,
  children,
}: {
  board: BoardData
  onToggleFocus: () => void
  children: React.ReactNode
}) {
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  // Last-seen task for the transient-loss fallback below. Declared up here
  // (not beside its reader) so no function captures it before its
  // declaration, which the compiler rejects.
  const [lastOpenTask, setLastOpenTask] = useState<Task | null>(null)
  const hoveredRef = useRef<string | null>(null)
  const setFocus = useSetTaskFocus()
  // Board snapshot for the TEMP-PROBE below. A ref (synced in an effect)
  // rather than `board` itself: reading `board` inside `openTask` would make
  // the compiler cache `openTask` on `board`, rebuilding `boardUI` on every
  // patch and re-rendering every row — the exact regression being measured.
  const boardRef = useRef(board)
  useEffect(() => {
    boardRef.current = board
  }, [board])

  // Task id -> index of flattened visible rows. Rebuilt only when the board
  // identity changes, so `findTask` below closes over a Map, not a nested
  // scan: O(1) per press instead of O(projects x tasks).
  const index = (() => {
    const m = new Map<string, { task: Task; project: (typeof board)[number] }>()
    for (const p of board) {
      for (const t of p.tasks) m.set(t.id, { task: t, project: p })
    }
    return m
  })()

  // Must not read `board` / `index`. The compiler caches this function
  // forever (sentinel), then caches `boardUI` forever. Capturing `findTask`
  // made `boardUI` a new object on every board patch, so every context
  // consumer (every task row) re-rendered on F. The dialog still gets the
  // task on the same click render via `foundOpenTask` below.
  const openTask = (id: string) => {
    // TEMP-PROBE(?perf=1): click timestamp + board scale for scaling analysis.
    // Reads `boardRef`, never `board`: keeps this function sentinel-stable.
    if (
      typeof window !== 'undefined' &&
      window.location.search.includes('perf')
    ) {
      performance.mark(`task-open-${id}`)
      ;(window as unknown as { __perfBoardTasks?: number }).__perfBoardTasks =
        boardRef.current.reduce((n, p) => n + p.tasks.length, 0)
    }
    setOpenTaskId(id)
  }
  const setHovered = (id: string | null) => {
    hoveredRef.current = id
  }
  const boardUI = { openTask, setHovered }

  // Trello-style keybindings: hover a task, hit a key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.isContentEditable)
      )
        return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === ']') {
        e.preventDefault()
        onToggleFocus()
        return
      }

      const id = hoveredRef.current
      if (!id) return
      const found = index.get(id)
      if (!found) return

      if (e.key === 'e' || e.key === 'Enter') {
        e.preventDefault()
        setOpenTaskId(id)
      } else if (e.key === 'f') {
        e.preventDefault()
        // TEMP-PROBE(?perf=1): F-to-first-paint + scale (project vs board).
        const perfOn =
          typeof window !== 'undefined' &&
          window.location.search.includes('perf')
        if (perfOn) {
          performance.mark(`task-focus-${id}`)
          const projSize = found.project.tasks.length
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const m = performance
                .getEntriesByName(`task-focus-${id}`)
                .pop()
              if (m) {
                console.log(
                  `[perf] f-press ${Math.round(performance.now() - m.startTime)}ms projectTasks=${projSize}`,
                )
              }
            }),
          )
        }
        setFocus.mutate({
          id,
          inFocus: !found.task.inFocus,
          focusOrder: Date.now() / 1000,
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, onToggleFocus, setFocus])

  // Hold the last-seen task across renders: a transient board state (an
  // optimistic update rolling back a beat before the server value arrives) can
  // momentarily lose the task, and letting `openTask` flip null would unmount
  // and remount the dialog — the backdrop blinks and in-progress edits are
  // wiped. The dialog only truly closes via onClose.
  //
  // Kept in state (synced in an effect) rather than a ref written during
  // render: ref access during render opts this whole host out of React
  // Compiler memoization. Same-id snapshots are kept as-is so a board patch
  // while the dialog is open doesn't cost an extra host render.
  const foundOpenTask = openTaskId ? (index.get(openTaskId)?.task ?? null) : null
  useEffect(() => {
    if (foundOpenTask) {
      setLastOpenTask((prev) =>
        prev?.id === foundOpenTask.id ? prev : foundOpenTask,
      )
    }
  }, [foundOpenTask])
  const openTaskData =
    foundOpenTask ??
    (openTaskId && lastOpenTask?.id === openTaskId ? lastOpenTask : null)

  return (
    <BoardUIContext.Provider value={boardUI}>
      {children}
      {openTaskData ? (
        <TaskDetails
          task={openTaskData}
          board={board}
          open={true}
          onClose={() => setOpenTaskId(null)}
        />
      ) : null}
    </BoardUIContext.Provider>
  )
}
