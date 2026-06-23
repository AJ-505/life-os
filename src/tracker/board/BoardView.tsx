import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  MeasuringFrequency,
  MeasuringStrategy,
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
import { FocusPanel } from '../focus/FocusPanel'
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
import { ProjectCard } from './ProjectCard'
import { TaskDetails } from './TaskDetails'
import { BoardUIContext } from './board-ui'

import type {
  CollisionDetection,
  DragEndEvent,
  DragStartEvent,
  DroppableContainer,
} from '@dnd-kit/core'
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
    // One pass over the droppables: bucket them by their declared `data.type`
    // and index them by id. The droppable count grows with every task and card,
    // and collision detection runs on *every* pointer move — so rescanning the
    // whole list (once per `byType` call, several times per move) was the hot
    // path. Group once, then read from the buckets.
    const buckets = new Map<string, Array<DroppableContainer>>()
    const byId = new Map<string | number, DroppableContainer>()
    for (const c of args.droppableContainers) {
      byId.set(c.id, c)
      const t = c.data.current?.type as string | undefined
      if (!t) continue
      const b = buckets.get(t)
      if (b) b.push(c)
      else buckets.set(t, [c])
    }
    const get = (...types: Array<string>): Array<DroppableContainer> =>
      types.length === 1
        ? buckets.get(types[0]) ?? []
        : types.flatMap((t) => buckets.get(t) ?? [])
    const hit = (cs: Array<DroppableContainer>) => {
      const scoped = { ...args, droppableContainers: cs }
      const p = pointerWithin(scoped)
      return p.length > 0 ? p : rectIntersection(scoped)
    }

    if (kind === 'proj') {
      const colHit = hit(get('col')).at(0)
      const colC = colHit ? byId.get(colHit.id) : undefined
      const y = args.pointerCoordinates?.y
      if (!colC || y == null) return hit(get('proj', 'col'))
      const colNum = colC.data.current?.col
      // Same column: the sortable is already shifting cards to open a gap where
      // you're hovering, so the plain pointer/rect hit lands exactly right.
      if (colNum === args.active.data.current?.col) return hit(get('proj', 'col'))
      // Cross column the target's cards *don't* shift (sortable only animates
      // within the source context), so the pointer sits in dead space between
      // cards and the sole hit is the column → the drop appended to the end.
      // Resolve by geometry instead: insert before the first card whose
      // vertical midpoint is below the pointer (or append, i.e. target the
      // column itself, when the pointer is below them all).
      const cards = get('proj')
        .filter((c) => c.data.current?.col === colNum)
        .sort(
          (a, b) =>
            (args.droppableRects.get(a.id)?.top ?? 0) -
            (args.droppableRects.get(b.id)?.top ?? 0),
        )
      const before = cards.find((c) => {
        const r = args.droppableRects.get(c.id)
        return r != null && y < r.top + r.height / 2
      })
      return before ? [{ id: before.id }] : [{ id: colC.id }]
    }

    if (kind === 'fitem') {
      const within = closestCenter({
        ...args,
        droppableContainers: get('fitem'),
      })
      return within.length > 0 ? within : hit(get('focuszone'))
    }

    if (kind === 'task') {
      // Pass 1 — which project list (or the focus zone) is the pointer inside?
      // Resolving the *container* first is what makes in-project reordering and
      // cross-project moves land where you actually release, instead of
      // snapping to the globally-nearest task anywhere on the board.
      const top = hit(get('list', 'focuszone')).at(0)
      const container = top ? byId.get(top.id) : undefined
      if (!container) {
        // Anywhere else on a project card (its header/edges) → drop into it.
        const onCard = hit(get('proj')).at(0)
        return onCard ? [{ id: onCard.id }] : []
      }
      if (container.data.current?.type === 'focuszone') {
        const within = closestCenter({
          ...args,
          droppableContainers: get('fitem'),
        })
        return within.length > 0 ? within : [{ id: container.id }]
      }
      // Pass 2 — the closest task row *within that project only*.
      const projectId = container.data.current?.projectId
      const rows = get('task').filter(
        (c) => c.data.current?.projectId === projectId,
      )
      const within = closestCenter({ ...args, droppableContainers: rows })
      return within.length > 0 ? within : [{ id: container.id }]
    }

    return closestCenter(args)
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

const BoardColumn = memo(function BoardColumn({
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
  const projects = useMemo(() => columnProjects(board, col), [board, col])
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
})

function GhostProjectCard({
  project,
}: {
  project: ProjectWithTasks
}) {
  const doneCount = project.tasks.filter((t) => t.done && !t.archived).length
  const totalCount = project.tasks.filter((t) => !t.archived).length
  const progress = totalCount === 0 ? 0 : doneCount / totalCount

  return (
    <div
      data-proj={project.color}
      className="rotate-1 flex flex-col overflow-hidden rounded-lg border bg-card shadow-xl ring-2 ring-signal/40"
    >
      <div className="relative h-1 bg-proj/25">
        <div
          className="h-full bg-proj transition-[width] duration-500"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <div className="flex items-center gap-1 px-2 py-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {project.name}
        </h3>
        <span className="font-mono text-[10px] text-muted-foreground">
          {doneCount}/{totalCount}
        </span>
      </div>
    </div>
  )
}

function GhostTaskRow({ task, showProject }: { task: Task; showProject?: string }) {
  return (
    <div className="flex cursor-grab items-start gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-sm shadow-lg">
      <div className="mt-0.5 size-4 shrink-0 rounded-full border border-muted-foreground/40" />
      <span className={cn('min-w-0 flex-1 text-left leading-snug', task.done && 'text-muted-foreground line-through decoration-border')}>
        {task.title}
        {showProject ? (
          <span className="mt-0.5 block truncate font-mono text-[10px] uppercase tracking-wider text-proj">
            {showProject}
          </span>
        ) : null}
      </span>
    </div>
  )
}

type ActiveDrag =
  | { type: 'proj'; project: ProjectWithTasks }
  | { type: 'task'; task: Task }
  | { type: 'fitem'; task: Task; project: ProjectWithTasks }

/**
 * Pixel-for-pixel drag overlay. Positions via direct DOM manipulation
 * (ref + requestAnimationFrame), bypassing React's render cycle entirely.
 * The 250ms CSS transition from useSortable is the #1 cause of drag lag —
 * this overlay never touches React state for its position.
 */
function FastDragOverlay({
  active,
  offsetRef,
  initialRef,
  children,
}: {
  active: ActiveDrag | null
  offsetRef: React.RefObject<{ x: number; y: number }>
  initialRef: React.RefObject<{ x: number; y: number }>
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const pos = useRef({ x: 0, y: 0 })
  const raf = useRef(0)

  useEffect(() => {
    if (!active) return
    // The portal node is recreated fresh each drag (we render null between
    // drags), so seed it at the grabbed item's original position. Otherwise it
    // renders at its `top:0;left:0` default and flashes at the top-left corner
    // for the frame before the first pointermove lands.
    if (ref.current) {
      ref.current.style.transform = `translate3d(${initialRef.current.x}px, ${initialRef.current.y}px, 0)`
    }
    const onMove = (e: PointerEvent) => {
      pos.current = { x: e.clientX, y: e.clientY }
      if (!raf.current) {
        raf.current = requestAnimationFrame(() => {
          raf.current = 0
          if (ref.current) {
            // Subtract where *inside* the item the user grabbed, so the ghost
            // sits under the cursor instead of a fixed corner offset — a
            // mispositioned ghost reads as "lag" even at a perfect 60fps.
            const { x, y } = offsetRef.current
            ref.current.style.transform = `translate3d(${pos.current.x - x}px, ${pos.current.y - y}px, 0)`
          }
        })
      }
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      if (raf.current) {
        cancelAnimationFrame(raf.current)
        // CRITICAL: reset the handle. The guard above is `if (!raf.current)`;
        // if a drag ends with a frame still pending, cancelling without
        // resetting leaves a stale non-zero id, so every *subsequent* drag's
        // guard fails, no transform is ever applied, and the (freshly mounted)
        // overlay stays pinned at the top-left until a full page reload.
        raf.current = 0
      }
    }
  }, [active, offsetRef, initialRef])

  if (!active) return null

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        willChange: 'transform',
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    >
      {children}
    </div>,
    document.body,
  )
}

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
  const grabOffset = useRef({ x: 10, y: 10 })
  const initialPos = useRef({ x: 0, y: 0 })
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

  // Stable UI api so memoized rows never re-render just because the board did
  // — or because a drag started/ended. The drag-active flag lives in its own
  // context (consumed only by the thin sortable wrappers), so the heavy,
  // memoized row bodies stay put across an entire drag.
  const handleOpenTask = useCallback((id: string) => setOpenTaskId(id), [])
  const setHovered = useCallback((id: string | null) => {
    hoveredRef.current = id
  }, [])
  const boardUI = useMemo(
    () => ({ openTask: handleOpenTask, setHovered }),
    [handleOpenTask, setHovered],
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
    // Remember where inside the item the pointer grabbed, so the overlay can
    // track the cursor 1:1 (see FastDragOverlay).
    const activator = e.activatorEvent as PointerEvent | null
    const rect = e.active.rect.current.initial
    grabOffset.current =
      activator && 'clientX' in activator && rect
        ? { x: activator.clientX - rect.left, y: activator.clientY - rect.top }
        : { x: 10, y: 10 }
    // The item's starting top-left, so the overlay can be seeded there before
    // the first pointermove (prevents a top-left flash on a fresh portal node).
    initialPos.current = rect ? { x: rect.left, y: rect.top } : { x: 0, y: 0 }
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
        measuring={{
          droppable: {
            strategy: MeasuringStrategy.WhileDragging,
            // Without an explicit frequency, the partial config drops dnd-kit's
            // default `Optimized` and re-measures every droppable far more
            // aggressively — pinning it back stops the leftmost/scrolled-away
            // cards from working off stale rects after a horizontal scroll.
            frequency: MeasuringFrequency.Optimized,
          },
        }}
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
            <div
              data-dragging={activeDrag ? '' : undefined}
              className="board-canvas board-scroll min-h-0 flex-1 snap-x snap-mandatory overflow-auto sm:snap-none"
            >
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

        <FastDragOverlay
          active={activeDrag}
          offsetRef={grabOffset}
          initialRef={initialPos}
        >
          {activeDrag?.type === 'proj' ? (
            <div className="w-[280px]">
              <GhostProjectCard project={activeDrag.project} />
            </div>
          ) : activeDrag?.type === 'task' ? (
            <div className="w-[260px]">
              <GhostTaskRow task={activeDrag.task} />
            </div>
          ) : activeDrag?.type === 'fitem' ? (
            <div className="w-[280px]">
              <GhostTaskRow task={activeDrag.task} showProject={activeDrag.project.name} />
            </div>
          ) : null}
        </FastDragOverlay>
      </DndContext>
    </BoardUIContext.Provider>
  )
}
