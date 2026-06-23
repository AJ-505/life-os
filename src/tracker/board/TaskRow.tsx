import { memo } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { format, isPast, isToday } from 'date-fns'
import { CornerDownRight, Crosshair } from 'lucide-react'

import { cn } from '#/design-system'
import { Checkbox } from '#/design-system/ui/checkbox'

import { POSITION_GAP } from '../types'
import { useSetTaskFocus, useUpdateTask } from '../queries'
import { taskId } from './board-logic'
import { useBoardUI } from './board-ui'

import type { TaskNode } from './board-logic'
import type { Task } from '../types'

export function DueChip({ due, done }: { due: Date | string; done?: boolean }) {
  const date = new Date(due)
  const overdue = !done && isPast(date) && !isToday(date)
  return (
    <span
      className={cn(
        'shrink-0 rounded-sm border px-1 py-px font-mono text-[10px] leading-4',
        overdue
          ? 'border-signal/40 bg-signal/10 font-semibold text-signal'
          : isToday(date) && !done
            ? 'border-signal/30 text-signal'
            : 'border-border text-muted-foreground',
      )}
    >
      {isToday(date) ? 'today' : format(date, 'd MMM')}
    </span>
  )
}

export const TaskRowBody = memo(function TaskRowBody({
  task,
  showProject,
  dragging,
  subtask,
}: {
  task: Task
  showProject?: string
  dragging?: boolean
  subtask?: boolean
}) {
  const updateTask = useUpdateTask()
  const setFocus = useSetTaskFocus()
  const { openTask, setHovered } = useBoardUI()

  return (
    <div
      onMouseEnter={() => setHovered(task.id)}
      onMouseLeave={() => setHovered(null)}
      className={cn(
        'group/task flex cursor-grab items-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm transition-colors hover:border-border hover:bg-accent/60 active:cursor-grabbing',
        dragging && 'border-border bg-card shadow-lg',
        subtask && 'py-1',
      )}
    >
      {subtask ? (
        <CornerDownRight className="mt-1 size-3 shrink-0 text-muted-foreground/50" />
      ) : null}
      <Checkbox
        checked={task.done}
        onCheckedChange={(checked) =>
          updateTask.mutate({ id: task.id, done: checked === true })
        }
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="Done"
        className="mt-0.5 rounded-full"
      />
      <button
        type="button"
        onClick={() => openTask(task.id)}
        onPointerDown={(e) => e.stopPropagation()}
        className={cn(
          'min-w-0 flex-1 cursor-pointer text-left leading-snug',
          task.done && 'text-muted-foreground line-through decoration-border',
        )}
      >
        {task.title}
        {showProject ? (
          <span className="mt-0.5 block truncate font-mono text-[10px] uppercase tracking-wider text-proj">
            {showProject}
          </span>
        ) : null}
      </button>
      {task.dueAt ? <DueChip due={task.dueAt} done={task.done} /> : null}
      <button
        type="button"
        aria-label={task.inFocus ? 'Remove from focus' : 'Add to focus'}
        onClick={() =>
          setFocus.mutate({
            id: task.id,
            inFocus: !task.inFocus,
            focusOrder: Date.now() / 1000 + POSITION_GAP,
          })
        }
        onPointerDown={(e) => e.stopPropagation()}
        className={cn(
          'mt-0.5 shrink-0 cursor-pointer transition-opacity',
          task.inFocus
            ? 'text-signal opacity-100'
            : 'text-muted-foreground opacity-0 hover:text-signal group-hover/task:opacity-100',
        )}
      >
        <Crosshair className="size-3.5" />
      </button>
    </div>
  )
})

function SubtaskRows({ nodes }: { nodes: Array<TaskNode> }) {
  return (
    <div className="ml-3.5 flex flex-col border-l border-border/60 pl-0.5">
      {nodes.map((n) => (
        <div key={n.task.id}>
          <TaskRowBody task={n.task} subtask />
          {n.children.length > 0 ? <SubtaskRows nodes={n.children} /> : null}
        </div>
      ))}
    </div>
  )
}

/** A sortable top-level task row; its subtask tree rides along inside it. */
export function TaskRow({ node }: { node: TaskNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: taskId(node.task.id),
      data: { type: 'task', taskId: node.task.id, projectId: node.task.projectId },
    })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        // The active row follows the cursor → no transition (it'd lag behind
        // the overlay). Displaced siblings keep dnd-kit's transform transition
        // so the "make room here" gap animates instead of snapping.
        transition: isDragging ? 'none' : transition,
      }}
      className={cn(isDragging && 'opacity-30')}
      {...attributes}
      {...listeners}
    >
      <TaskRowBody task={node.task} />
      {node.children.length > 0 ? <SubtaskRows nodes={node.children} /> : null}
    </div>
  )
}
