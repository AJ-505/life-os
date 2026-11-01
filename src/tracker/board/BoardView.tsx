import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  MeasuringFrequency,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Check, Crosshair, Plus } from 'lucide-react'
import { toast } from 'sonner'

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

import { PROJECT_COLORS, newId, positionAfter } from '../types'
import {
  type CreateProjectArgs,
  boardQueryOptions,
  useCreateProject,
  useMoveProject,
  useMoveTask,
  useSetTaskFocus,
  useUpdateTask,
} from '../queries'
import { FocusPanel } from '../focus/FocusPanel'
import {
  canvasProjects,
  boardColumns,
  colId,
  columnProjects,
  focusDrop,
  focusTasks,
  parseDragId,
  projId,
  projectDrop,
  taskDrop,
  visibleTasks,
  buildTaskIndex,
  projectCounts,
} from './board-logic'
import { ProjectCard } from './ProjectCard'
import { BoardHeader } from './BoardHeader'
import { ResizableFocusPanel } from './ResizableFocusPanel'
import { TaskDetailsHost } from './TaskDetailsHost'
import {
  CalendarEventCard,
  CalendarView,
  calendarSlotAt,
} from '../calendar/CalendarView'
import { atMinute, dropMinute } from '../calendar/calendar-logic'

import type {
  CollisionDetection,
  DragEndEvent,
  DragStartEvent,
  DroppableContainer,
} from '@dnd-kit/core'
import type { BoardData, ProjectWithTasks, Task } from '../types'

type DragKind = 'proj' | 'task' | 'fitem' | 'cal' | null

export type BoardViewMode = 'board' | 'calendar'

const mouseSensorOptions = { activationConstraint: { distance: 5 } }
const touchSensorOptions = {
  activationConstraint: { delay: 250, tolerance: 5 },
}
const dndMeasuring = {
  droppable: {
    strategy: MeasuringStrategy.WhileDragging,
    frequency: MeasuringFrequency.Optimized,
  },
}

function collisionFor(kind: DragKind): CollisionDetection {
  return (args) => {
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
        ? (buckets.get(types[0]) ?? [])
        : types.flatMap((t) => buckets.get(t) ?? [])
    const hit = (cs: Array<DroppableContainer>) => {
      const scoped = { ...args, droppableContainers: cs }
      const p = pointerWithin(scoped)
      return p.length > 0 ? p : rectIntersection(scoped)
    }

    const point = args.pointerCoordinates
    if (point && (kind === 'task' || kind === 'fitem' || kind === 'cal')) {
      const slot = calendarSlotAt(point)
      if (slot) return [{ id: slot }]
    }

    if (kind === 'proj') {
      const colHit = hit(get('col')).at(0)
      const colC = colHit ? byId.get(colHit.id) : undefined
      const y = args.pointerCoordinates?.y
      if (!colC || y == null) return hit(get('proj', 'col'))
      const colNum = colC.data.current?.col
      if (colNum === args.active.data.current?.col)
        return hit(get('proj', 'col'))
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

    if (kind === 'task' || kind === 'cal') {
      const top = hit(get('list', 'focuszone')).at(0)
      const container = top ? byId.get(top.id) : undefined
      if (!container) {
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
  spaceId,
}: {
  open: boolean
  onClose: () => void
  gridCol: number
  board: BoardData
  spaceId: string | null
}) {
  const createProject = useCreateProject()
  const [name, setName] = useState('')
  const nextColor = (offset: number) =>
    PROJECT_COLORS[
      (canvasProjects(board).length + offset) % PROJECT_COLORS.length
    ]
  const [color, setColor] = useState<string>(nextColor(0))

  const create = (args: CreateProjectArgs) => {
    createProject.mutate(args, {
      onError: (e: unknown) => {
        toast.error('Could not create the project', {
          description: e instanceof Error ? e.message : String(e),
          action: { label: 'Retry', onClick: () => create(args) },
        })
      },
    })
  }

  const submit = () => {
    const n = name.trim()
    if (!n) return
    if (createProject.isPending) return
    create({
      id: newId(),
      name: n,
      color,
      spaceId,
      gridCol,
      gridRow: positionAfter(
        columnProjects(board, gridCol).map((p) => ({ position: p.gridRow })),
      ),
    })
    setName('')
    setColor(nextColor(1))
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
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                submit()
              }}
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
                  {color === c ? (
                    <Check className="size-3.5 text-white" />
                  ) : null}
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

function GhostProjectCard({ project }: { project: ProjectWithTasks }) {
  const { doneCount, totalCount, progress } = projectCounts(project)

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

function GhostTaskRow({
  task,
  showProject,
}: {
  task: Task
  showProject?: string
}) {
  return (
    <div className="flex cursor-grab items-start gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-sm shadow-lg">
      <div className="mt-0.5 size-4 shrink-0 rounded-full border border-muted-foreground/40" />
      <span
        className={cn(
          'min-w-0 flex-1 text-left leading-snug',
          task.done && 'text-muted-foreground line-through decoration-border',
        )}
      >
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
  | { type: 'cal'; task: Task; project: ProjectWithTasks; width: number }

function FastDragOverlay({
  active,
  offsetRef,
  initialRef,
  pointerRef,
  children,
}: {
  active: ActiveDrag | null
  offsetRef: React.RefObject<{ x: number; y: number }>
  initialRef: React.RefObject<{ x: number; y: number }>
  pointerRef: React.RefObject<{ x: number; y: number }>
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const pos = pointerRef
  const raf = useRef(0)

  useEffect(() => {
    if (!active) return
    if (ref.current) {
      ref.current.style.transform = `translate3d(${initialRef.current.x}px, ${initialRef.current.y}px, 0)`
    }
    const onMove = (e: PointerEvent) => {
      pos.current = { x: e.clientX, y: e.clientY }
      if (!raf.current) {
        raf.current = requestAnimationFrame(() => {
          raf.current = 0
          if (ref.current) {
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
        raf.current = 0
      }
    }
  }, [active, offsetRef, initialRef, pos])

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

function calendarDropAt(
  dst: { kind: 'day' | 'allday'; key: string },
  ghostTop: number,
): number {
  const dayStart = Number(dst.key)
  if (dst.kind === 'allday') return dayStart
  const column = document.querySelector(`[data-cal-day="${dst.key}"]`)
  const top = column?.getBoundingClientRect().top ?? ghostTop
  return atMinute(dayStart, dropMinute(ghostTop - top))
}

export function BoardView({
  spaceId,
  view,
}: {
  spaceId: string | null
  view: BoardViewMode
}) {
  const { data: board } = useSuspenseQuery(boardQueryOptions(spaceId))
  const moveProject = useMoveProject()
  const moveTask = useMoveTask()
  const setFocus = useSetTaskFocus()
  const updateTask = useUpdateTask()

  const [showDone, setShowDone] = useLocalFlag('lifeos-show-done', false)
  const [focusOpen, setFocusOpen] = useLocalFlag('lifeos-focus-open', true)
  const focusOpenRef = useRef(focusOpen)
  const [mobileFocusOpen, setMobileFocusOpen] = useState(false)
  const [newProjectCol, setNewProjectCol] = useState<number | null>(null)
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null)
  const grabOffset = useRef({ x: 10, y: 10 })
  const initialPos = useRef({ x: 0, y: 0 })
  const pointerPos = useRef({ x: 0, y: 0 })
  const [dragKind, setDragKind] = useState<DragKind>(null)
  const collisionDetection = collisionFor(dragKind)

  const toggleFocus = () => setFocusOpen(!focusOpenRef.current)
  const closeFocus = () => setFocusOpen(false)

  useEffect(() => {
    focusOpenRef.current = focusOpen
  }, [focusOpen])

  const sensors = useSensors(
    useSensor(MouseSensor, mouseSensorOptions),
    useSensor(TouchSensor, touchSensorOptions),
  )

  const columns = boardColumns(board)
  const ghostCol = (columns.at(-1) ?? -1) + 1
  const active = canvasProjects(board)
  const openCount = active.reduce(
    (n, p) => n + p.tasks.filter((t) => !t.done && !t.archived).length,
    0,
  )

  const taskIndex = buildTaskIndex(board)
  const findTask = (id: string) => taskIndex.get(id) ?? null

  const onDragStart = (e: DragStartEvent) => {
    const parsed = parseDragId(e.active.id)
    if (!parsed) return
    const activator = e.activatorEvent as PointerEvent | null
    const rect = e.active.rect.current.initial
    grabOffset.current =
      activator && 'clientX' in activator && rect
        ? { x: activator.clientX - rect.left, y: activator.clientY - rect.top }
        : { x: 10, y: 10 }
    initialPos.current = rect ? { x: rect.left, y: rect.top } : { x: 0, y: 0 }
    pointerPos.current =
      activator && 'clientX' in activator
        ? { x: activator.clientX, y: activator.clientY }
        : { x: initialPos.current.x, y: initialPos.current.y }
    if (parsed.kind === 'proj') {
      const project = board.find((p) => p.id === parsed.key)
      if (project) setActiveDrag({ type: 'proj', project })
      setDragKind('proj')
    } else if (parsed.kind === 'task') {
      const found = findTask(parsed.key)
      if (found) setActiveDrag({ type: 'task', task: found.task })
      setDragKind('task')
    } else if (parsed.kind === 'cal') {
      const found = findTask(parsed.key)
      if (found)
        setActiveDrag({
          type: 'cal',
          task: found.task,
          project: found.project,
          width: rect?.width ?? 140,
        })
      setDragKind('cal')
    } else if (parsed.kind === 'fitem') {
      const found = findTask(parsed.key)
      if (found)
        setActiveDrag({
          type: 'fitem',
          task: found.task,
          project: found.project,
        })
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

    if (dst.kind === 'day' || dst.kind === 'allday') {
      if (src.kind !== 'task' && src.kind !== 'fitem' && src.kind !== 'cal')
        return
      const dueAt = calendarDropAt(
        { kind: dst.kind, key: dst.key },
        pointerPos.current.y - grabOffset.current.y,
      )
      if (findTask(src.key)?.task.dueAt !== dueAt)
        updateTask.mutate({ id: src.key, dueAt })
      return
    }

    const dirSide = (
      orderedIds: Array<string>,
      overKey: string,
    ): 'before' | 'after' | null => {
      const ai = orderedIds.indexOf(src.key)
      const oi = orderedIds.indexOf(overKey)
      if (ai === -1 || oi === -1) return null
      return ai < oi ? 'after' : 'before'
    }
    const activeRect = a.rect.current.translated
    const rectSide: 'before' | 'after' =
      activeRect &&
      activeRect.top + activeRect.height / 2 >
        over.rect.top + over.rect.height / 2
        ? 'after'
        : 'before'

    if (src.kind === 'proj') {
      let target: { gridCol: number; gridRow: number } | null = null
      if (dst.kind === 'col') {
        target = projectDrop(board, src.key, { kind: 'col', key: dst.key })
      } else {
        let projKey: string | null = null
        if (dst.kind === 'proj') {
          projKey = dst.key
        } else if (dst.kind === 'list') {
          projKey = dst.key
        } else if (dst.kind === 'task') {
          projKey = findTask(dst.key)?.project.id ?? null
        }
        if (!projKey || projKey === src.key) return
        const proj = board.find((p) => p.id === projKey)
        const orderedProjects = proj
          ? columnProjects(board, proj.gridCol).map((p) => p.id)
          : []
        const projSide =
          dst.kind === 'proj'
            ? (dirSide(orderedProjects, projKey) ?? rectSide)
            : 'before'
        target = projectDrop(
          board,
          src.key,
          { kind: 'proj', key: projKey },
          projSide,
        )
      }
      if (target) moveProject.mutate({ id: src.key, ...target })
      return
    }

    if (src.kind === 'task' || src.kind === 'cal') {
      if (dst.kind === 'focuszone' || dst.kind === 'fitem') {
        const focusOrder = focusDrop(
          board,
          src.key,
          { kind: dst.kind, key: dst.key },
          dst.kind === 'fitem' ? rectSide : 'before',
        )
        setFocus.mutate({ id: src.key, inFocus: true, focusOrder })
        return
      }
      if (dst.kind === 'proj') dst = { kind: 'list', key: dst.key }
      if (dst.kind !== 'task' && dst.kind !== 'list') return
      const { kind: dstKind, key: dstKey } = dst
      const overProj =
        dstKind === 'task'
          ? board.find((p) => p.tasks.some((t) => t.id === dstKey))
          : null
      const orderedTasks = overProj
        ? visibleTasks(overProj, showDone || overProj.showDone).map((t) => t.id)
        : []
      const taskSide =
        dstKind === 'task'
          ? (dirSide(orderedTasks, dstKey) ?? rectSide)
          : 'before'
      const target = taskDrop(
        board,
        src.key,
        { kind: dstKind, key: dstKey },
        showDone,
        taskSide,
      )
      if (target) moveTask.mutate({ id: src.key, ...target })
      return
    }

    if (src.kind === 'fitem') {
      if (dst.kind !== 'focuszone' && dst.kind !== 'fitem') return
      const orderedFocus = focusTasks(board).map((e) => e.task.id)
      const focusSide =
        dst.kind === 'fitem'
          ? (dirSide(orderedFocus, dst.key) ?? rectSide)
          : 'before'
      const focusOrder = focusDrop(
        board,
        src.key,
        { kind: dst.kind, key: dst.key },
        focusSide,
      )
      setFocus.mutate({ id: src.key, inFocus: true, focusOrder })
    }
  }

  const onDragCancel = () => {
    setActiveDrag(null)
    setDragKind(null)
  }

  return (
    <TaskDetailsHost board={board} onToggleFocus={toggleFocus}>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        measuring={dndMeasuring}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <BoardHeader
              activeCount={active.length}
              openCount={openCount}
              showDone={showDone}
              onShowDoneChange={setShowDone}
              defaultCol={columns.at(-1) ?? 0}
              onNewProject={setNewProjectCol}
              focusOpen={focusOpen}
              onToggleFocus={toggleFocus}
              view={view}
            />

            {view === 'calendar' ? (
              <CalendarView board={board} showDone={showDone} />
            ) : (
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
            )}
          </div>

          {}
          {focusOpen && spaceId === null ? (
            <ResizableFocusPanel board={board} onClose={closeFocus} />
          ) : null}
        </div>

        {}
        {spaceId === null ? (
          <Button
            size="icon"
            aria-label="Open focus"
            className="fixed bottom-5 right-5 z-40 size-12 rounded-full bg-signal text-signal-foreground shadow-xl hover:bg-signal/90 lg:hidden"
            onClick={() => setMobileFocusOpen(true)}
          >
            <Crosshair className="size-5" />
          </Button>
        ) : null}
        {spaceId === null ? (
          <Sheet open={mobileFocusOpen} onOpenChange={setMobileFocusOpen}>
            <SheetContent
              side="right"
              noAnimation
              className="w-[88vw] max-w-sm p-0 pt-8"
            >
              <FocusPanel board={board} />
            </SheetContent>
          </Sheet>
        ) : null}

        <NewProjectDialog
          open={newProjectCol !== null}
          onClose={() => setNewProjectCol(null)}
          gridCol={newProjectCol ?? 0}
          board={board}
          spaceId={spaceId}
        />

        <FastDragOverlay
          active={activeDrag}
          offsetRef={grabOffset}
          initialRef={initialPos}
          pointerRef={pointerPos}
        >
          {activeDrag?.type === 'proj' ? (
            <div className="w-[280px]">
              <GhostProjectCard project={activeDrag.project} />
            </div>
          ) : activeDrag?.type === 'task' ? (
            <div className="w-[260px]">
              <GhostTaskRow task={activeDrag.task} />
            </div>
          ) : activeDrag?.type === 'cal' ? (
            <div className="h-12" style={{ width: activeDrag.width }}>
              <CalendarEventCard
                task={activeDrag.task}
                project={activeDrag.project}
                compact
                dragging
              />
            </div>
          ) : activeDrag?.type === 'fitem' ? (
            <div className="w-[280px]">
              <GhostTaskRow
                task={activeDrag.task}
                showProject={activeDrag.project.name}
              />
            </div>
          ) : null}
        </FastDragOverlay>
      </DndContext>
    </TaskDetailsHost>
  )
}
