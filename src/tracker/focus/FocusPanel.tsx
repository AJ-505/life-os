import { memo } from 'react'
import { useDroppable } from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Crosshair, PanelRightClose, X } from 'lucide-react'

import { cn } from '#/design-system'
import { Button } from '#/design-system/ui/button'
import { Checkbox } from '#/design-system/ui/checkbox'
import { ScrollArea } from '#/design-system/ui/scroll-area'

import { useSetTaskFocus, useUpdateTask } from '../queries'
import { focusItemId, focusTasks } from '../board/board-logic'
import { useDragActive } from '../board/board-ui'
import { DueChip } from '../board/TaskRow'

import type { BoardData, Project, Task } from '../types'

export const FocusItemBody = memo(function FocusItemBody({
  task,
  project,
  dragging,
}: {
  task: Task
  project: Project
  dragging?: boolean
}) {
  const updateTask = useUpdateTask()
  const setFocus = useSetTaskFocus()

  return (
    <div
      data-proj={project.color}
      className={cn(
        'group/focus relative flex cursor-grab items-start gap-2 rounded-md border bg-card py-2 pl-3 pr-2 shadow-sm transition-colors hover:border-proj/40 active:cursor-grabbing',
        dragging && 'shadow-lg ring-2 ring-signal/40',
      )}
    >
      {/* the non-distracting project cue: a colored spine */}
      <span className="absolute inset-y-1.5 left-1 w-0.5 rounded-full bg-proj" />
      <Checkbox
        checked={task.done}
        onCheckedChange={(checked) =>
          updateTask.mutate({ id: task.id, done: checked === true })
        }
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="Done"
        className="mt-0.5 rounded-full"
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-sm leading-snug',
            task.done && 'text-muted-foreground line-through decoration-border',
          )}
        >
          {task.title}
        </p>
        <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-wider text-proj/80">
          {project.name}
        </p>
      </div>
      {task.dueAt ? <DueChip due={task.dueAt} done={task.done} /> : null}
      <button
        type="button"
        aria-label="Remove from focus"
        onClick={() => setFocus.mutate({ id: task.id, inFocus: false })}
        onPointerDown={(e) => e.stopPropagation()}
        className="mt-0.5 shrink-0 cursor-pointer text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/focus:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
})

function FocusItem({ task, project }: { task: Task; project: Project }) {
  const isDraggingBoard = useDragActive()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: focusItemId(task.id),
      data: { type: 'fitem', taskId: task.id },
    })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: isDraggingBoard ? 'none' : transition,
      }}
      className={cn(isDragging && 'opacity-30')}
      {...attributes}
      {...listeners}
    >
      <FocusItemBody task={task} project={project} />
    </div>
  )
}

export function FocusPanel({
  board,
  onClose,
}: {
  board: BoardData
  onClose?: () => void
}) {
  const setFocus = useSetTaskFocus()
  const items = focusTasks(board)
  const doneItems = items.filter((t) => t.done)

  const { setNodeRef, isOver } = useDroppable({
    id: 'focuszone',
    data: { type: 'focuszone' },
  })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <span className="os-label flex items-center gap-1.5 !text-signal">
          <Crosshair className="size-3.5" />
          Focus
          <span className="rounded-sm bg-signal/15 px-1 font-semibold">
            {items.filter((t) => !t.done).length}
          </span>
        </span>
        <div className="flex items-center gap-1">
          {doneItems.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-muted-foreground"
              onClick={() =>
                doneItems.forEach((t) =>
                  setFocus.mutate({ id: t.id, inFocus: false }),
                )
              }
            >
              Clear done
            </Button>
          ) : null}
          {onClose ? (
            <Button
              variant="ghost"
              size="icon"
              className="hidden size-6 text-muted-foreground lg:inline-flex"
              aria-label="Collapse focus panel (])"
              title="Collapse  ]"
              onClick={onClose}
            >
              <PanelRightClose className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div
          ref={setNodeRef}
          className={cn(
            'mx-3 mb-3 flex min-h-40 flex-col gap-1.5 rounded-lg p-1 transition-colors',
            isOver && 'bg-signal/10 ring-2 ring-signal/30',
          )}
        >
          <SortableContext
            items={items.map((t) => focusItemId(t.id))}
            strategy={verticalListSortingStrategy}
          >
            {items.map((t) => (
              <FocusItem key={t.id} task={t} project={t.project} />
            ))}
          </SortableContext>
          {items.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-6 text-center">
              <Crosshair className="size-5 text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">
                Drag tasks here — or hit the <Crosshair className="inline size-3" />{' '}
                on any task. It stays in its project.
              </p>
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  )
}
