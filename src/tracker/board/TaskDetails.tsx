import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Archive, CalendarIcon, Crosshair, Plus, Trash2, X } from 'lucide-react'

import { cn } from '#/design-system'
import { Button } from '#/design-system/ui/button'
import { Calendar } from '#/design-system/ui/calendar'
import { Checkbox } from '#/design-system/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/design-system/ui/dialog'
import { Input } from '#/design-system/ui/input'
import { Label } from '#/design-system/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/design-system/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/design-system/ui/select'
import { Switch } from '#/design-system/ui/switch'
import { Textarea } from '#/design-system/ui/textarea'

import { POSITION_GAP, newId, positionAfter } from '../types'
import {
  useCreateTask,
  useDeleteTask,
  useMoveTask,
  useSetTaskFocus,
  useUpdateTask,
} from '../queries'

import type { BoardData, Task } from '../types'

function Subtasks({ parent, board }: { parent: Task; board: BoardData }) {
  const createTask = useCreateTask()
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const [title, setTitle] = useState('')

  const project = board.find((p) => p.id === parent.projectId)
  const children = (project?.tasks ?? [])
    .filter((t) => t.parentId === parent.id && !t.archived)
    .sort((a, b) => a.position - b.position)

  const add = () => {
    const t = title.trim()
    if (!t) return
    createTask.mutate({
      id: newId(),
      projectId: parent.projectId,
      parentId: parent.id,
      title: t,
      position: positionAfter(children),
    })
    setTitle('')
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="os-label">
        Subtasks{children.length > 0 ? ` · ${children.filter((c) => c.done).length}/${children.length}` : ''}
      </Label>
      <div className="flex flex-col gap-0.5">
        {children.map((c) => (
          <div
            key={c.id}
            className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent/60"
          >
            <Checkbox
              checked={c.done}
              onCheckedChange={(checked) =>
                updateTask.mutate({ id: c.id, done: checked === true })
              }
              aria-label="Done"
              className="rounded-full"
            />
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-sm',
                c.done && 'text-muted-foreground line-through decoration-border',
              )}
            >
              {c.title}
            </span>
            <button
              type="button"
              aria-label="Delete subtask"
              onClick={() => deleteTask.mutate({ id: c.id })}
              className="shrink-0 cursor-pointer text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5 px-1">
        <Plus className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Add a subtask"
          className="w-full bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground/70"
        />
      </div>
    </div>
  )
}

export function TaskDetails({
  task,
  board,
  open,
  onClose,
}: {
  task: Task
  board: BoardData
  open: boolean
  onClose: () => void
}) {
  const updateTask = useUpdateTask()
  const moveTask = useMoveTask()
  const setFocus = useSetTaskFocus()
  const deleteTask = useDeleteTask()

  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes ?? '')

  useEffect(() => {
    if (open) {
      setTitle(task.title)
      setNotes(task.notes ?? '')
    }
  }, [open, task.id])

  const project = board.find((p) => p.id === task.projectId)
  const activeProjects = board.filter((p) => p.status === 'active')

  const commitText = () => {
    const t = title.trim()
    const n = notes.trim()
    if (t !== task.title || n !== (task.notes ?? '')) {
      updateTask.mutate({ id: task.id, title: t || task.title, notes: n || null })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && (commitText(), onClose())}>
      <DialogContent className="max-w-md" data-proj={project?.color}>
        <DialogHeader>
          <DialogTitle className="sr-only">Task details</DialogTitle>
          <span className="os-label flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-proj" />
            {project?.name}
          </span>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitText}
            className="border-0 border-b border-border bg-transparent px-0 text-base font-medium shadow-none focus-visible:ring-0"
            aria-label="Task title"
          />

          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={commitText}
            placeholder="Notes…"
            rows={3}
            className="resize-none"
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="os-label">Due</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      'justify-start gap-2 font-mono text-xs',
                      !task.dueAt && 'text-muted-foreground',
                    )}
                  >
                    <CalendarIcon className="size-3.5" />
                    {task.dueAt
                      ? format(new Date(task.dueAt), 'd MMM yyyy')
                      : 'No date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={task.dueAt ? new Date(task.dueAt) : undefined}
                    onSelect={(d) =>
                      updateTask.mutate({
                        id: task.id,
                        dueAt: d ? d.getTime() : null,
                      })
                    }
                  />
                  {task.dueAt ? (
                    <div className="border-t p-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={() =>
                          updateTask.mutate({ id: task.id, dueAt: null })
                        }
                      >
                        Clear date
                      </Button>
                    </div>
                  ) : null}
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="os-label">Project</Label>
              <Select
                value={task.projectId}
                onValueChange={(projectId) => {
                  const target = board.find((p) => p.id === projectId)
                  if (!target || projectId === task.projectId) return
                  moveTask.mutate({
                    id: task.id,
                    projectId,
                    position: positionAfter(target.tasks),
                  })
                }}
              >
                <SelectTrigger size="sm" className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {activeProjects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Subtasks parent={task} board={board} />

          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <span className="flex items-center gap-2 text-sm">
              <Crosshair
                className={cn(
                  'size-4',
                  task.inFocus ? 'text-signal' : 'text-muted-foreground',
                )}
              />
              In focus
            </span>
            <Switch
              checked={task.inFocus}
              onCheckedChange={(inFocus) =>
                setFocus.mutate({
                  id: task.id,
                  inFocus,
                  focusOrder: Date.now() / 1000 + POSITION_GAP,
                })
              }
            />
          </div>
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground"
              onClick={() => {
                updateTask.mutate({ id: task.id, archived: !task.archived })
                onClose()
              }}
            >
              <Archive className="size-3.5" />
              {task.archived ? 'Unarchive' : 'Archive'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={() => {
                deleteTask.mutate({ id: task.id })
                onClose()
              }}
            >
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          </div>
          <Button size="sm" onClick={() => (commitText(), onClose())}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
