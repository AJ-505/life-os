import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
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

import { cn, useLocalFlag } from '#/design-system'
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

import { PROJECT_COLORS, newId, positionAfter } from '../types'
import {
  boardQueryOptions,
  useCreateProject,
  useMoveProject,
  useMoveTask,
  useSetTaskFocus,
} from '../queries'
import { FocusItemBody, FocusPanel } from '../focus/FocusPanel'
import {
  activeProjects,
  boardColumns,
  colId,
  columnProjects,
  focusDrop,
  parseDragId,
  projId,
  projectDrop,
  taskDrop,
} from './board-logic'
import { ProjectCard, ProjectCardBody } from './ProjectCard'
import { TaskRowBody } from './TaskRow'
import { TaskDetails } from './TaskDetails'
import { BoardUIContext } from './board-ui'

import type { CollisionDetection, DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import type { BoardData, ProjectWithTasks, Task } from '../types'

type DragKind = 'proj' | 'task' | 'fitem' | null

/**
 * The board nests droppables three deep (column ▸ task list ▸ task rows).
 * A naive pointerWithin then resolves a task drag to the *column* under the
 * cursor, which onDragEnd can't act on — so drops silently no-op. This
 * detection filters candidate droppables to only those that make sense for
 * what's being dragged, so a task always lands on a task/list/focus target.
 */
function collisionFor(kind: DragKind): CollisionDetection {
  return (args) => {
    const allow = (raw: string | number) => {
      const k = parseDragId(raw)?.kind
      if (kind === 'proj') return k === 'proj' || k === 'col'
      if (kind === 'task')
        return k === 'task' || k === 'list' || k === 'fitem' || k === 'focuszone'
      if (kind === 'fitem') return k === 'fitem' || k === 'focuszone'
      return true
    }
    const droppableContainers = args.droppableContainers.filter((c) =>
      allow(c.id),
    )
    const scoped = { ...args, droppableContainers }

    // Projects are big rectangles → pointer/rect works best. Tasks & focus
    // items are a tight sortable list → closestCenter gives clean reordering.
    if (kind === 'proj') {
      const pointer = pointerWithin(scoped)
      return pointer.length > 0 ? pointer : rectIntersection(scoped)
    }
    return closestCenter(scoped)
  }
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
      id: newId(),
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
          <ProjectCard key={p.id} project={p} showDone={showDone} />
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
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const hoveredRef = useRef<string | null>(null)
  const [dragKind, setDragKind] = useState<DragKind>(null)
  const collisionDetection = useMemo(() => collisionFor(dragKind), [dragKind])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
  )

  const columns = useMemo(() => boardColumns(board), [board])
  const ghostCol = (columns.at(-1) ?? -1) + 1
  const active = activeProjects(board)
  const openCount = useMemo(
    () =>
      active.reduce(
        (n, p) => n + p.tasks.filter((t) => !t.done && !t.archived).length,
        0,
      ),
    [active],
  )

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

  // Stable UI api so memoized rows never re-render just because the board did.
  const boardUI = useMemo(
    () => ({
      openTask: (id: string) => setOpenTaskId(id),
      setHovered: (id: string | null) => {
        hoveredRef.current = id
      },
    }),
    [],
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
        setFocusOpen(!focusOpen)
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
  }, [findTask, focusOpen, setFocusOpen, setFocus])

  const onDragStart = (e: DragStartEvent) => {
    const parsed = parseDragId(e.active.id)
    if (!parsed) return
    if (parsed.kind === 'proj') {
      const project = board.find((p) => p.id === parsed.key)
      if (project) setActiveDrag({ type: 'proj', project })
      setDragKind('proj')
    } else if (parsed.kind === 'task') {
      const found = findTask(parsed.key)
      if (found) setActiveDrag({ type: 'task', task: found.task })
      setDragKind('task')
    } else if (parsed.kind === 'fitem') {
      const found = findTask(parsed.key)
      if (found)
        setActiveDrag({ type: 'fitem', task: found.task, project: found.project })
      setDragKind('fitem')
    }
  }

  const onDragEnd = (e: DragEndEvent) => {
    setActiveDrag(null)
    setDragKind(null)
    const { active: a, over } = e
    if (!over) return
    const src = parseDragId(a.id)
    let dst = parseDragId(over.id)
    if (!src || !dst) return

    if (src.kind === 'proj') {
      let target: { gridCol: number; gridRow: number } | null = null
      if (dst.kind === 'col') {
        target = projectDrop(board, src.key, { kind: 'col', key: dst.key })
      } else {
        // hovering a project's interior (a task or its list) means "insert
        // before that project"
        let projKey: string | null = null
        if (dst.kind === 'proj') {
          projKey = dst.key
        } else if (dst.kind === 'list') {
          projKey = dst.key
        } else if (dst.kind === 'task') {
          projKey = findTask(dst.key)?.project.id ?? null
        }
        if (!projKey || projKey === src.key) return
        target = projectDrop(board, src.key, { kind: 'proj', key: projKey })
      }
      if (target) moveProject.mutate({ id: src.key, ...target })
      return
    }

    if (src.kind === 'task') {
      if (dst.kind === 'focuszone' || dst.kind === 'fitem') {
        const focusOrder = focusDrop(board, src.key, {
          kind: dst.kind,
          key: dst.key,
        })
        setFocus.mutate({ id: src.key, inFocus: true, focusOrder })
        return
      }
      if (dst.kind === 'proj') dst = { kind: 'list', key: dst.key }
      if (dst.kind !== 'task' && dst.kind !== 'list') return
      const target = taskDrop(
        board,
        src.key,
        { kind: dst.kind, key: dst.key },
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
      })
      setFocus.mutate({ id: src.key, inFocus: true, focusOrder })
    }
  }

  const openTask = openTaskId ? findTask(openTaskId)?.task ?? null : null

  return (
    <BoardUIContext.Provider value={boardUI}>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setActiveDrag(null)
          setDragKind(null)
        }}
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
                  onClick={() => setNewProjectCol(columns.at(-1) ?? 0)}
                >
                  <Plus className="size-4" /> Project
                </Button>
                <Button
                  variant={focusOpen ? 'secondary' : 'ghost'}
                  size="icon"
                  className="hidden lg:inline-flex"
                  aria-label="Toggle focus panel (])"
                  title="Toggle focus panel  ]"
                  onClick={() => setFocusOpen(!focusOpen)}
                >
                  <Crosshair className={cn('size-4', focusOpen && 'text-signal')} />
                </Button>
              </div>
            </div>

            {/* Canvas */}
            <div className="board-canvas board-scroll min-h-0 flex-1 snap-x snap-mandatory overflow-auto sm:snap-none">
              <div className="flex min-h-full items-start gap-2 p-3 pb-24 lg:pb-3">
                {columns.map((col) => (
                  <BoardColumn
                    key={col}
                    col={col}
                    board={board}
                    showDone={showDone}
                    onAddProject={setNewProjectCol}
                  />
                ))}
                <BoardColumn
                  col={ghostCol}
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
              <FocusPanel board={board} onClose={() => setFocusOpen(false)} />
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

        {/* One details dialog for the whole board — not one per card. */}
        {openTask ? (
          <TaskDetails
            task={openTask}
            board={board}
            open={true}
            onClose={() => setOpenTaskId(null)}
          />
        ) : null}

        <DragOverlay dropAnimation={null}>
          {activeDrag?.type === 'proj' ? (
            <div className="w-[280px]">
              <ProjectCardBody project={activeDrag.project} showDone={showDone} ghost />
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
    </BoardUIContext.Provider>
  )
}
