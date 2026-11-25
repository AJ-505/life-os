import { createContext, useContext, useRef, useState } from 'react'

import { useKeyShortcuts } from '#/design-system'
import { buildTaskIndex } from './board-logic'
import { appendFocusOrder } from './placement'
import { useBoardScope } from '../board-scope'
import { useSetTaskFocus } from '../queries'
import { TaskDetails } from './TaskDetails'

import type { BoardData, Task } from '../types'

type BoardUI = {
  openTask: (id: string) => void
  setHovered: (id: string | null) => void
  toggleFocus: (task: Task) => void
}

const BoardUIContext = createContext<BoardUI | null>(null)

export function useBoardUI(): BoardUI {
  const boardUI = useContext(BoardUIContext)
  if (!boardUI) throw new Error('useBoardUI needs TaskDetailsHost')
  return boardUI
}

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
  const { can } = useBoardScope()

  const index = buildTaskIndex(board)

  const toggleFocus = (task: Task) => {
    if (!can.focus) return
    setFocus.mutate({
      id: task.id,
      inFocus: !task.inFocus,
      focusOrder: appendFocusOrder(board, task.id),
    })
  }

  const boardUI: BoardUI = {
    openTask: setOpenTaskId,
    setHovered: (id) => {
      hoveredRef.current = id
    },
    toggleFocus,
  }

  useKeyShortcuts((event) => {
    if (event.key === ']') {
      event.preventDefault()
      onToggleFocus()
      return
    }
    const id = hoveredRef.current
    const found = id ? index.get(id) : undefined
    if (!id || !found) return
    if (event.key === 'e' || event.key === 'Enter') {
      event.preventDefault()
      setOpenTaskId(id)
    } else if (event.key === 'f' && can.focus) {
      event.preventDefault()
      toggleFocus(found.task)
    }
  })

  const foundOpenTask = openTaskId
    ? (index.get(openTaskId)?.task ?? null)
    : null
  if (foundOpenTask && lastOpenTask?.id !== foundOpenTask.id)
    setLastOpenTask(foundOpenTask)
  const openTaskData =
    foundOpenTask ??
    (openTaskId && lastOpenTask?.id === openTaskId ? lastOpenTask : null)

  return (
    <BoardUIContext.Provider value={boardUI}>
      {children}
      {openTaskData ? (
        <TaskDetails
          key={openTaskData.id}
          task={openTaskData}
          board={board}
          onClose={() => setOpenTaskId(null)}
        />
      ) : null}
    </BoardUIContext.Provider>
  )
}
