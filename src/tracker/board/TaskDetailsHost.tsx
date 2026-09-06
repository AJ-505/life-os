import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
  const hoveredRef = useRef<string | null>(null)
  const setFocus = useSetTaskFocus()

  const findTask = useCallback(
    (id: string) => {
      for (const p of board) {
        const t = p.tasks.find((x) => x.id === id)
        if (t) return { task: t, project: p }
      }
      return null
    },
    [board],
  )

  const openTask = useCallback((id: string) => setOpenTaskId(id), [])
  const setHovered = useCallback((id: string | null) => {
    hoveredRef.current = id
  }, [])
  const boardUI = useMemo(
    () => ({ openTask, setHovered }),
    [openTask, setHovered],
  )

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
      const found = findTask(id)
      if (!found) return

      if (e.key === 'e' || e.key === 'Enter') {
        e.preventDefault()
        setOpenTaskId(id)
      } else if (e.key === 'f') {
        e.preventDefault()
        setFocus.mutate({
          id,
          inFocus: !found.task.inFocus,
          focusOrder: Date.now() / 1000,
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [findTask, onToggleFocus, setFocus])

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
  const [lastOpenTask, setLastOpenTask] = useState<Task | null>(null)
  const foundOpenTask = openTaskId ? findTask(openTaskId)?.task ?? null : null
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
