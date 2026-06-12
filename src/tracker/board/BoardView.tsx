import { useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Check, Crosshair, Plus } from 'lucide-react'

import { cn } from '#/design-system'
import { Button } from '#/design-system/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/design-system/ui/dialog'
import { Input } from '#/design-system/ui/input'
import { Label } from '#/design-system/ui/label'
import { Sheet, SheetContent } from '#/design-system/ui/sheet'
import { Switch } from '#/design-system/ui/switch'

import { PROJECT_COLORS, positionAfter } from '../types'
import { boardQueryOptions, useCreateProject, useMoveProject, useMoveTask, useSetTaskFocus } from '../queries'
import { FocusItemBody, FocusPanel } from '../focus/FocusPanel'
import {
  activeProjects,
  colId,
  columnCount,
  columnProjects,
  focusDrop,
  parseDragId,
  projId,
  projectDrop,
  taskDrop,
} from './board-logic'
import { ProjectCard, ProjectCardBody } from './ProjectCard'
import { TaskRowBody } from './TaskRow'

import type { CollisionDetection, DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import type { BoardData, ProjectWithTasks, Task } from '../types'

const collisionDetection: CollisionDetection = (args) => {
  const pointer = pointerWithin(args)
  return pointer.length > 0 ? pointer : rectIntersection(args)
}

function useLocalFlag(key: string, initial: boolean) {
  const [value, setValue] = useState(initial)
  useEffect(() => {
    const stored = localStorage.getItem(key)
    if (stored !== null) setValue(stored === '1')
  }, [key])
  const update = (v: boolean) => {
    setValue(v)
    localStorage.setItem(key, v ? '1' : '0')
  }
  return [value, update] as const
}

function NewProjectDialog({
  open,
  onClose,
  gridCol,
  board,
}: {
  open: boolean
  onClose: () => void
  gridCol: number
  board: BoardData
}) {
  const createProject = useCreateProject()
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(
    PROJECT_COLORS[activeProjects(board).length % PROJECT_COLORS.length],
  )

  const submit = () => {
    const n = name.trim()
    if (!n) return
    createProject.mutate({
      name: n,
      color,
      gridCol,
      gridRow: positionAfter(
        columnProjects(board, gridCol).map((p) => ({ position: p.gridRow })),
      ),
    })
    setName('')
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="os-label">Name</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="e.g. PAU Archive, Sem 2, Apartment hunt…"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="os-label">Color</Label>
            <div className="flex flex-wrap gap-2">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  data-proj={c}
                  aria-label={c}
                  onClick={() => setColor(c)}
                  className={cn(
                    'flex size-7 cursor-pointer items-center justify-center rounded-full bg-proj transition-transform hover:scale-110',
                    color === c &&
                      'ring-2 ring-ring ring-offset-2 ring-offset-card',
                  )}
                >
                  {color === c ? <Check className="size-3.5 text-white" /> : null}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" onClick={submit} disabled={!name.trim()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BoardColumn({
  col,
  board,
  showDone,
  isGhost,
  onAddProject,
}: {
  col: number
  board: BoardData
  showDone: boolean
  isGhost?: boolean
  onAddProject: (col: number) => void
}) {
  const projects = columnProjects(board, col)
  const { setNodeRef, isOver } = useDroppable({
    id: colId(col),
    data: { type: 'col', col },
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-[82vw] shrink-0 snap-start flex-col gap-3 rounded-xl p-1.5 transition-colors sm:w-[300px]',
        isOver && 'bg-accent/50 ring-1 ring-border',
        isGhost && 'opacity-80',
      )}
    >
      <SortableContext
        items={projects.map((p) => projId(p.id))}
        strategy={verticalListSortingStrategy}
      >
        {projects.map((p) => (
          <ProjectCard key={p.id} project={p} board={board} showDone={showDone} />
        ))}
      </SortableContext>
      <button
        type="button"
        onClick={() => onAddProject(col)}
        className={cn(
          'flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed py-2 text-xs text-muted-foreground/70 transition-colors hover:border-foreground/30 hover:text-foreground',
          isGhost && projects.length === 0 && 'min-h-24',
        )}
      >
        <Plus className="size-3.5" />
        {isGhost ? 'New column' : 'Project'}
      </button>
    </div>
  )
}

type ActiveDrag =
  | { type: 'proj'; project: ProjectWithTasks }
  | { type: 'task'; task: Task }
  | { type: 'fitem'; task: Task; project: ProjectWithTasks }

export function BoardView() {
  const { data: board } = useSuspenseQuery(boardQueryOptions)
  const moveProject = useMoveProject()
  const moveTask = useMoveTask()
  const setFocus = useSetTaskFocus()

  const [showDone, setShowDone] = useLocalFlag('lifeos-show-done', false)
  const [focusOpen, setFocusOpen] = useLocalFlag('lifeos-focus-open', true)
  const [mobileFocusOpen, setMobileFocusOpen] = useState(false)
  const [newProjectCol, setNewProjectCol] = useState<number | null>(null)
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 220, tolerance: 8 },
    }),
  )

  const cols = columnCount(board)
  const active = activeProjects(board)
  const openCount = useMemo(
    () =>
      active.reduce(
        (n, p) => n + p.tasks.filter((t) => !t.done && !t.archived).length,
        0,
      ),
    [active],
  )

  const findTask = (id: string) => {
    for (const p of board) {
      const t = p.tasks.find((x) => x.id === id)
      if (t) return { task: t, project: p }
    }
    return null
  }

  const onDragStart = (e: DragStartEvent) => {
    const parsed = parseDragId(e.active.id)
    if (!parsed) return
    if (parsed.kind === 'proj') {
      const project = board.find((p) => p.id === parsed.key)
      if (project) setActiveDrag({ type: 'proj', project })
    } else if (parsed.kind === 'task') {
      const found = findTask(parsed.key)
      if (found) setActiveDrag({ type: 'task', task: found.task })
    } else if (parsed.kind === 'fitem') {
      const found = findTask(parsed.key)
      if (found)
        setActiveDrag({ type: 'fitem', task: found.task, project: found.project })
    }
  }

  const onDragEnd = (e: DragEndEvent) => {
    setActiveDrag(null)
    const { active: a, over } = e
    if (!over) return
    const src = parseDragId(a.id)
    let dst = parseDragId(over.id)
    if (!src || !dst) return
    const overIndex: number =
      (over.data.current as { sortable?: { index: number } } | undefined)
        ?.sortable?.index ?? 0

    if (src.kind === 'proj') {
      let target: { gridCol: number; gridRow: number } | null = null
      if (dst.kind === 'col') {
        target = projectDrop(board, src.key, {
          kind: 'col',
          key: dst.key,
          overIndex,
        })
      } else {
        // hovering a project's interior (a task or its list) counts as
        // hovering the project itself, inserted just above it
        let projKey: string | null = null
        let idx = overIndex
        if (dst.kind === 'proj') {
          projKey = dst.key
        } else if (dst.kind === 'task' || dst.kind === 'list') {
          projKey =
            dst.kind === 'list'
              ? dst.key
              : (findTask(dst.key)?.project.id ?? null)
          const overProject = board.find((p) => p.id === projKey)
          if (!overProject) return
          idx = columnProjects(board, overProject.gridCol).findIndex(
            (p) => p.id === projKey,
          )
        }
        if (!projKey || projKey === src.key) return
        target = projectDrop(board, src.key, {
          kind: 'proj',
          key: projKey,
          overIndex: idx,
        })
      }
      if (target) moveProject.mutate({ id: src.key, ...target })
      return
    }

    if (src.kind === 'task') {
      if (dst.kind === 'focuszone' || dst.kind === 'fitem') {
        const focusOrder = focusDrop(board, src.key, {
          kind: dst.kind,
          key: dst.key,
          overIndex,
        })
        setFocus.mutate({ id: src.key, inFocus: true, focusOrder })
        return
      }
      if (dst.kind === 'proj') dst = { kind: 'list', key: dst.key }
      if (dst.kind !== 'task' && dst.kind !== 'list') return
      const target = taskDrop(
        board,
        src.key,
        { kind: dst.kind, key: dst.key, overIndex },
        showDone,
      )
      if (target) moveTask.mutate({ id: src.key, ...target })
      return
    }

    if (src.kind === 'fitem') {
      if (dst.kind !== 'focuszone' && dst.kind !== 'fitem') return
      const focusOrder = focusDrop(board, src.key, {
        kind: dst.kind,
        key: dst.key,
        overIndex,
      })
      setFocus.mutate({ id: src.key, inFocus: true, focusOrder })
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveDrag(null)}
    >
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2.5">
            <div className="flex items-baseline gap-3">
              <h1 className="text-lg font-bold tracking-tight">Board</h1>
              <span className="os-label hidden sm:inline">
                {active.length} projects · {openCount} open
              </span>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1.5">
                <Switch
                  checked={showDone}
                  onCheckedChange={setShowDone}
                  aria-label="Show completed tasks"
                />
                <span className="os-label hidden sm:inline">done</span>
              </label>
              <Button
                size="sm"
                className="gap-1.5 bg-signal text-signal-foreground hover:bg-signal/90"
                onClick={() => setNewProjectCol(cols - 1)}
              >
                <Plus className="size-4" /> Project
              </Button>
              <Button
                variant={focusOpen ? 'secondary' : 'ghost'}
                size="icon"
                className="hidden lg:inline-flex"
                aria-label="Toggle focus panel"
                onClick={() => setFocusOpen(!focusOpen)}
              >
                <Crosshair className={cn('size-4', focusOpen && 'text-signal')} />
              </Button>
            </div>
          </div>

          {/* Canvas */}
          <div className="board-canvas board-scroll min-h-0 flex-1 snap-x snap-mandatory overflow-auto sm:snap-none">
            <div className="flex min-h-full items-start gap-2 p-3 pb-24 lg:pb-3">
              {Array.from({ length: cols }, (_, col) => (
                <BoardColumn
                  key={col}
                  col={col}
                  board={board}
                  showDone={showDone}
                  onAddProject={setNewProjectCol}
                />
              ))}
              <BoardColumn
                col={cols}
                board={board}
                showDone={showDone}
                isGhost
                onAddProject={setNewProjectCol}
              />
            </div>
          </div>
        </div>

        {/* Desktop focus panel */}
        {focusOpen ? (
          <aside className="hidden w-80 shrink-0 border-l bg-sidebar/50 lg:block">
            <FocusPanel board={board} />
          </aside>
        ) : null}
      </div>

      {/* Mobile focus */}
      <Button
        size="icon"
        aria-label="Open focus"
        className="fixed bottom-5 right-5 z-40 size-12 rounded-full bg-signal text-signal-foreground shadow-xl hover:bg-signal/90 lg:hidden"
        onClick={() => setMobileFocusOpen(true)}
      >
        <Crosshair className="size-5" />
      </Button>
      <Sheet open={mobileFocusOpen} onOpenChange={setMobileFocusOpen}>
        <SheetContent side="right" className="w-[88vw] max-w-sm p-0 pt-8">
          <FocusPanel board={board} />
        </SheetContent>
      </Sheet>

      <NewProjectDialog
        open={newProjectCol !== null}
        onClose={() => setNewProjectCol(null)}
        gridCol={newProjectCol ?? 0}
        board={board}
      />

      <DragOverlay>
        {activeDrag?.type === 'proj' ? (
          <div className="w-[280px]">
            <ProjectCardBody
              project={activeDrag.project}
              board={board}
              showDone={showDone}
              ghost
            />
          </div>
        ) : activeDrag?.type === 'task' ? (
          <div className="w-[260px]">
            <TaskRowBody task={activeDrag.task} dragging />
          </div>
        ) : activeDrag?.type === 'fitem' ? (
          <div className="w-[280px]">
            <FocusItemBody
              task={activeDrag.task}
              project={activeDrag.project}
              dragging
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
