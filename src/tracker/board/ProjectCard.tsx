import { memo, useMemo, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { format } from 'date-fns'
import {
  Archive,
  CalendarIcon,
  Check,
  ChevronDown,
  CircleCheckBig,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'

import { cn } from '#/design-system'
import { Button } from '#/design-system/ui/button'
import { Calendar } from '#/design-system/ui/calendar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/design-system/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/design-system/ui/dropdown-menu'
import { Input } from '#/design-system/ui/input'
import { Label } from '#/design-system/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/design-system/ui/popover'

import { PROJECT_COLORS, newId, positionAfter } from '../types'
import {
  useCreateTask,
  useDeleteProject,
  useSetProjectStatus,
  useUpdateProject,
} from '../queries'
import { listId, projId, taskId, taskTree } from './board-logic'
import { useDragActive } from './board-ui'
import { TaskRow } from './TaskRow'

import type { ProjectWithTasks } from '../types'

function ColorSwatches({
  value,
  onChange,
}: {
  value: string
  onChange: (c: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {PROJECT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          data-proj={c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cn(
            'flex size-7 cursor-pointer items-center justify-center rounded-full bg-proj transition-transform hover:scale-110',
            value === c && 'ring-2 ring-ring ring-offset-2 ring-offset-card',
          )}
        >
          {value === c ? <Check className="size-3.5 text-white" /> : null}
        </button>
      ))}
    </div>
  )
}

export function ProjectEditDialog({
  project,
  open,
  onClose,
}: {
  project: ProjectWithTasks
  open: boolean
  onClose: () => void
}) {
  const updateProject = useUpdateProject()
  const [name, setName] = useState(project.name)
  const [color, setColor] = useState(project.color)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="os-label">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="os-label">Color</Label>
            <ColorSwatches value={color} onChange={setColor} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="os-label">Target date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    'justify-start gap-2 font-mono text-xs',
                    !project.targetDate && 'text-muted-foreground',
                  )}
                >
                  <CalendarIcon className="size-3.5" />
                  {project.targetDate
                    ? format(new Date(project.targetDate), 'd MMM yyyy')
                    : 'No target'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={
                    project.targetDate ? new Date(project.targetDate) : undefined
                  }
                  onSelect={(d) =>
                    updateProject.mutate({
                      id: project.id,
                      targetDate: d ? d.toISOString() : null,
                    })
                  }
                />
                {project.targetDate ? (
                  <div className="border-t p-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      onClick={() =>
                        updateProject.mutate({ id: project.id, targetDate: null })
                      }
                    >
                      Clear target
                    </Button>
                  </div>
                ) : null}
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <DialogFooter>
          <Button
            size="sm"
            onClick={() => {
              updateProject.mutate({
                id: project.id,
                name: name.trim() || project.name,
                color,
              })
              onClose()
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddTaskInput({ project }: { project: ProjectWithTasks }) {
  const createTask = useCreateTask()
  const [title, setTitle] = useState('')

  const submit = () => {
    const t = title.trim()
    if (!t) return
    createTask.mutate({
      id: newId(),
      projectId: project.id,
      title: t,
      position: positionAfter(project.tasks.filter((x) => !x.parentId)),
    })
    setTitle('')
  }

  return (
    <div className="flex items-center gap-1.5 px-1 pt-1">
      <Plus className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Add a task"
        className="w-full bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground/70"
      />
    </div>
  )
}

export const ProjectCardBody = memo(function ProjectCardBody({
  project,
  showDone,
  dragHandle,
  ghost,
}: {
  project: ProjectWithTasks
  showDone: boolean
  dragHandle?: Record<string, unknown>
  ghost?: boolean
}) {
  const updateProject = useUpdateProject()
  const setStatus = useSetProjectStatus()
  const deleteProject = useDeleteProject()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const { setNodeRef: setListRef, isOver: listIsOver } = useDroppable({
    id: listId(project.id),
    data: { type: 'list', projectId: project.id },
    disabled: ghost,
  })

  const nodes = useMemo(() => taskTree(project, showDone), [project, showDone])
  const doneCount = project.tasks.filter((t) => t.done && !t.archived).length
  const totalCount = project.tasks.filter((t) => !t.archived).length
  const progress = totalCount === 0 ? 0 : doneCount / totalCount

  return (
    <div
      data-proj={project.color}
      className={cn(
        'flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm transition-shadow',
        ghost && 'rotate-1 shadow-xl ring-2 ring-signal/40',
        listIsOver && 'ring-2 ring-signal/60 bg-signal/5 shadow-md',
      )}
    >
      {/* identity bar + progress */}
      <div className="relative h-1 bg-proj/25">
        <div
          className="h-full bg-proj transition-[width] duration-500"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div
        className="flex cursor-grab items-center gap-1 px-2 py-2 active:cursor-grabbing"
        {...(dragHandle ?? {})}
      >
        <button
          type="button"
          aria-label={project.collapsed ? 'Expand' : 'Collapse'}
          onClick={() =>
            updateProject.mutate({ id: project.id, collapsed: !project.collapsed })
          }
          onPointerDown={(e) => e.stopPropagation()}
          className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ChevronDown
            className={cn(
              'size-4 transition-transform duration-200',
              project.collapsed && '-rotate-90',
            )}
          />
        </button>
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {project.name}
        </h3>
        {project.targetDate ? (
          <span className="rounded-sm border border-proj/30 px-1 py-px font-mono text-[10px] text-proj">
            {format(new Date(project.targetDate), 'd MMM')}
          </span>
        ) : null}
        <span className="font-mono text-[10px] text-muted-foreground">
          {doneCount}/{totalCount}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 p-1 text-muted-foreground"
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Project menu"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setStatus.mutate({ id: project.id, status: 'shelved' })}
            >
              <Archive /> Shelve
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setStatus.mutate({ id: project.id, status: 'done' })}
            >
              <CircleCheckBig /> Finish
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {!project.collapsed && !ghost ? (
        <div ref={setListRef} className="flex flex-col gap-0.5 px-1.5 pb-2">
          <SortableContext
            items={nodes.map((n) => taskId(n.task.id))}
            strategy={verticalListSortingStrategy}
          >
            {nodes.map((n) => (
              <TaskRow key={n.task.id} node={n} />
            ))}
          </SortableContext>
          {nodes.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground/60">
              {totalCount > 0 ? 'All done in here.' : 'Nothing yet.'}
            </p>
          ) : null}
          <AddTaskInput project={project} />
        </div>
      ) : null}

      {project.collapsed && !ghost ? (
        <div ref={setListRef} className="px-3 pb-2">
          <p className="os-label">{totalCount - doneCount} open</p>
        </div>
      ) : null}

      <ProjectEditDialog
        project={project}
        open={editing}
        onClose={() => setEditing(false)}
      />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete “{project.name}”?</DialogTitle>
            <DialogDescription>
              The project and its {totalCount} task{totalCount === 1 ? '' : 's'}{' '}
              will be permanently deleted. If you just want it out of sight,
              shelve it instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setStatus.mutate({ id: project.id, status: 'shelved' })
                setConfirmDelete(false)
              }}
            >
              Shelve
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteProject.mutate({ id: project.id })}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
},
(prev, next) =>
  // The drag handle (attributes+listeners) is re-allocated every render but
  // never meaningfully changes — comparing the real inputs lets a project's
  // body skip re-rendering (and re-rendering all its task rows) mid-drag.
  prev.project === next.project &&
  prev.showDone === next.showDone &&
  prev.ghost === next.ghost,
)

export function ProjectCard({
  project,
  showDone,
}: {
  project: ProjectWithTasks
  showDone: boolean
}) {
  const isDraggingBoard = useDragActive()
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: projId(project.id),
    data: { type: 'proj', projectId: project.id },
  })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: isDraggingBoard ? 'none' : transition,
      }}
      className={cn(isDragging && 'opacity-30')}
    >
      <ProjectCardBody
        project={project}
        showDone={showDone}
        dragHandle={{ ...attributes, ...listeners }}
      />
    </div>
  )
}
