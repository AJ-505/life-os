import { useEffect, useRef, useState } from 'react'

import { buildTaskIndex } from './board-logic'
import { useBoardScope } from '../board-scope'
import { useSetTaskFocus } from '../queries'
import { BoardUIContext } from './board-ui'
import { TaskDetails } from './TaskDetails'

import type { BoardData, Task } from '../types'

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
  const [lastOpenTask, setLastOpenTask] = useState<Task | null>(null)
  const hoveredRef = useRef<string | null>(null)
  const setFocus = useSetTaskFocus()
  const spaceId = useBoardScope()

  const index = buildTaskIndex(board)

  const openTask = (id: string) => {
    setOpenTaskId(id)
  }
  const setHovered = (id: string | null) => {
    hoveredRef.current = id
  }
  const boardUI = { openTask, setHovered }

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
      } else if (e.key === 'f' && spaceId === null) {
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
  }, [index, onToggleFocus, setFocus, spaceId])

  const foundOpenTask = openTaskId
    ? (index.get(openTaskId)?.task ?? null)
    : null
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
