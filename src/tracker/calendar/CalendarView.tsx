import { useEffect, useRef, useState } from 'react'
import { useDndMonitor, useDraggable, useDroppable } from '@dnd-kit/core'
import { addDays } from 'date-fns/addDays'
import { format } from 'date-fns/format'
import { isSameMonth } from 'date-fns/isSameMonth'
import { isToday } from 'date-fns/isToday'
import { ChevronLeft, ChevronRight, Flag, Grid2x2 } from 'lucide-react'

import { cn, useMediaQuery } from '#/design-system'
import { Button } from '#/design-system/ui/button'
import { Input } from '#/design-system/ui/input'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '#/design-system/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/design-system/ui/select'

import { newId, positionAfter } from '../types'
import { CalendarSyncButton } from './CalendarSyncButton'
import { ExternalEventCard } from './ExternalEventCard'
import { useBackwardSync } from './pull'
import { useAddTask, useUpdateTask } from '../queries'
import { useBoardScope } from '../board-scope'
import { activeProjects } from '../board/board-logic'
import { useBoardUI } from '../board/board-ui'
import {
  BLOCK_MINUTES,
  allDayId,
  atMinute,
  blockShortLabel,
  calTaskId,
  calendarWeek,
  cardDensity,
  dayId,
  dragSpan,
  durationLabel,
  hourPxFor,
  importedEventIds,
  labelStep,
  minuteOfDay,
  resizedMinutes,
  slotMinute,
  timeLabel,
  visibleDays,
} from './calendar-logic'

import type {
  BlockMinutes,
  CalendarDay,
  CalendarTask,
  PlacedTask,
  TimedEntry,
} from './calendar-logic'
import type { BoardData, Project, ProjectWithTasks, Task } from '../types'

type Draft = { dayStart: number; minute: number | null; minutes?: number }

const DRAG_THRESHOLD_PX = 8

const DRAFT_BOX_CLASSES =
  'pointer-events-none absolute inset-x-0 z-20 rounded-md border border-dashed border-signal/60 bg-signal/10 px-1.5 py-0.5 font-mono text-[10px] leading-none text-signal'

export function calendarSlotAt(point: { x: number; y: number }) {
  const hit = document.elementFromPoint(point.x, point.y)
  return hit?.closest<HTMLElement>('[data-cal-drop]')?.dataset.calDrop ?? null
}

function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

function weekLabel(days: Array<Date>) {
  const first = days[0]
  const last = days[days.length - 1]
  return isSameMonth(first, last)
    ? format(first, 'MMMM yyyy')
    : `${format(first, 'MMM')} – ${format(last, 'MMM yyyy')}`
}

export function CalendarEventCard({
  task,
  project,
  compact,
  tight,
  dragging,
}: {
  task: Task
  project: Project
  compact?: boolean
  tight?: boolean
  dragging?: boolean
}) {
  return (
    <div
      data-proj={project.color}
      className={cn(
        '@container flex h-full min-w-0 flex-col overflow-hidden rounded-md border-l-2 border-proj bg-proj/15 px-1.5 text-left text-proj transition-colors hover:bg-proj/25',
        compact ? 'py-0.5' : 'py-1',
        tight && 'py-0',
        task.done && 'opacity-55',
        dragging && 'bg-proj/30 shadow-lg ring-2 ring-signal/40',
      )}
    >
      <span
        className={cn(
          'truncate text-xs font-medium leading-tight text-foreground @max-[5.5rem]:line-clamp-2 @max-[5.5rem]:whitespace-normal @max-[5.5rem]:[overflow-wrap:anywhere]',
          tight && 'text-[10px] leading-none',
          task.done && 'line-through decoration-border',
        )}
      >
        {task.title}
      </span>
      {!compact && task.dueAt !== null ? (
        <span className="truncate font-mono text-[10px] leading-tight @max-[5.5rem]:hidden">
          {timeLabel(minuteOfDay(task.dueAt))}
        </span>
      ) : null}
    </div>
  )
}

function DraggableTask({
  entry,
  compact,
  tight,
  className,
  style,
}: {
  entry: CalendarTask
  compact?: boolean
  tight?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  const { openTask, setHovered } = useBoardUI()
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: calTaskId(entry.task.id),
    data: { type: 'cal', taskId: entry.task.id },
  })

  return (
    <button
      ref={setNodeRef}
      type="button"
      style={style}
      onClick={() => openTask(entry.task.id)}
      onMouseEnter={() => setHovered(entry.task.id)}
      onMouseLeave={() => setHovered(null)}
      className={cn(
        'cursor-pointer select-none [-webkit-touch-callout:none]',
        isDragging && 'opacity-30',
        className,
      )}
      {...attributes}
      {...listeners}
    >
      <CalendarEventCard
        task={entry.task}
        project={entry.project}
        compact={compact}
        tight={tight}
      />
    </button>
  )
}

type PlacedTaskEntry = Extract<PlacedTask, { kind: 'task' }>

function ResizeHandle({
  placed,
  hourPx,
  blockMinutes,
  onLive,
}: {
  placed: PlacedTaskEntry
  hourPx: number
  blockMinutes: BlockMinutes
  onLive: (minutes: number | null) => void
}) {
  const updateTask = useUpdateTask()
  const drag = useRef<{ y: number; minutes: number } | null>(null)
  const short = cardDensity(placed.minutes, hourPx) !== 'full'

  const minutesAt = (clientY: number) =>
    resizedMinutes(
      placed.start,
      placed.minutes,
      clientY - (drag.current?.y ?? clientY),
      blockMinutes,
      hourPx,
    )

  return (
    <div
      role="separator"
      aria-label="Resize event"
      className={cn(
        'absolute inset-x-1 bottom-0 z-10 hidden cursor-ns-resize touch-none items-end justify-center [@media(pointer:fine)]:flex',
        short ? 'h-1' : 'h-2',
      )}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { y: e.clientY, minutes: placed.minutes }
      }}
      onPointerMove={(e) => {
        if (drag.current) onLive(minutesAt(e.clientY))
      }}
      onPointerUp={(e) => {
        if (!drag.current) return
        const minutes = minutesAt(e.clientY)
        drag.current = null
        if (minutes === placed.minutes) {
          onLive(null)
          return
        }
        onLive(minutes)
        updateTask.mutate(
          { id: placed.task.id, durationMinutes: minutes },
          { onSettled: () => onLive(null) },
        )
      }}
      onPointerCancel={() => {
        drag.current = null
        onLive(null)
      }}
    >
      <span
        className={cn(
          'w-6 rounded-full bg-foreground/30',
          short ? 'h-px' : 'mb-0.5 h-0.5',
        )}
      />
    </div>
  )
}

function TimedEntryView({
  placed,
  projects,
  hourPx,
  blockMinutes,
}: {
  placed: PlacedTask
  projects: Array<ProjectWithTasks>
  hourPx: number
  blockMinutes: BlockMinutes
}) {
  const [live, setLive] = useState<number | null>(null)
  const minutes = live ?? placed.minutes
  const density = cardDensity(minutes, hourPx)

  if (placed.kind === 'external') {
    return (
      <div
        className="absolute z-10 p-px"
        style={{
          top: (placed.start / 60) * hourPx,
          height: (minutes / 60) * hourPx,
          left: `${(placed.lane / placed.lanes) * 100}%`,
          width: `${100 / placed.lanes}%`,
        }}
      >
        <ExternalEventCard
          event={placed.event}
          placed={placed}
          compact={density !== 'full'}
          projects={projects}
        />
      </div>
    )
  }

  return (
    <div
      className="absolute z-10 p-px"
      style={{
        top: (placed.start / 60) * hourPx,
        height: (minutes / 60) * hourPx,
        left: `${(placed.lane / placed.lanes) * 100}%`,
        width: `${100 / placed.lanes}%`,
      }}
    >
      <DraggableTask
        entry={placed}
        compact={density !== 'full'}
        tight={density === 'tight'}
        className="block size-full"
      />
      <ResizeHandle
        placed={placed}
        hourPx={hourPx}
        blockMinutes={blockMinutes}
        onLive={setLive}
      />
    </div>
  )
}

function DraftAnchor({
  minute,
  minutes,
  hourPx,
}: {
  minute: number
  minutes: number
  hourPx: number
}) {
  return (
    <PopoverAnchor
      className={DRAFT_BOX_CLASSES}
      style={{
        top: (minute / 60) * hourPx,
        height: (minutes / 60) * hourPx,
      }}
    >
      {`${timeLabel(minute)} – ${timeLabel(minute + minutes)}`}
    </PopoverAnchor>
  )
}

function AllDayCell({
  day,
  draft,
  onDraft,
  projects,
}: {
  day: CalendarDay
  draft: Draft | null
  onDraft: (draft: Draft) => void
  projects: Array<ProjectWithTasks>
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: allDayId(day.start),
    data: { type: 'allday' },
  })

  return (
    <div
      ref={setNodeRef}
      data-cal-drop={allDayId(day.start)}
      onClick={(e) => {
        if (e.target === e.currentTarget)
          onDraft({ dayStart: day.start, minute: null })
      }}
      className={cn(
        'flex min-h-8 min-w-0 cursor-pointer flex-col gap-0.5 border-l p-0.5 transition-colors',
        isOver && 'bg-accent/60',
      )}
    >
      {day.milestones.map((project) => (
        <div
          key={project.id}
          data-proj={project.color}
          title={`${project.name} target`}
          className="pointer-events-none flex h-5 items-center gap-1 rounded-md border border-proj/40 bg-proj/5 px-1.5 text-[11px] font-medium"
        >
          <Flag className="size-3 shrink-0 text-proj" />
          <span className="truncate">{project.name}</span>
        </div>
      ))}
      {day.allDay.map((entry) => (
        <DraggableTask
          key={entry.task.id}
          entry={entry}
          compact
          className="h-5"
        />
      ))}
      {day.externalAllDay.map((event) => (
        <ExternalEventCard
          key={event.eventId}
          event={event}
          compact
          projects={projects}
        />
      ))}
      {draft !== null &&
      draft.dayStart === day.start &&
      draft.minute === null ? (
        <PopoverAnchor className="h-5 rounded-md border border-dashed border-signal/60 bg-signal/10" />
      ) : null}
    </div>
  )
}

function DayColumn({
  day,
  now,
  draft,
  blockMinutes,
  hourPx,
  onDraft,
  projects,
}: {
  day: CalendarDay
  now: number
  draft: Draft | null
  blockMinutes: BlockMinutes
  hourPx: number
  onDraft: (draft: Draft) => void
  projects: Array<ProjectWithTasks>
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: dayId(day.start),
    data: { type: 'day' },
  })
  const today = isToday(day.start)
  const blockPx = (blockMinutes / 60) * hourPx
  const [span, setSpan] = useState<{ minute: number; minutes: number } | null>(
    null,
  )
  const drag = useRef<{ downPx: number; moved: boolean } | null>(null)
  const dragged = useRef(false)

  const offsetOf = (clientY: number, el: HTMLElement) =>
    clientY - el.getBoundingClientRect().top

  // Touch skips the press-drag so the column keeps scrolling; taps fall
  // through to the click handler below.
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' || e.button !== 0) return
    if (e.target !== e.currentTarget) return
    // Throws when the pointer went away between the event and this call.
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Keep the press-drag alive; moves still reach the column without it.
    }
    dragged.current = false
    drag.current = {
      downPx: offsetOf(e.clientY, e.currentTarget),
      moved: false,
    }
  }

  const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state) return
    const px = offsetOf(e.clientY, e.currentTarget)
    if (!state.moved) {
      if (Math.abs(px - state.downPx) < DRAG_THRESHOLD_PX) return
      state.moved = true
    }
    setSpan(dragSpan(state.downPx, px, blockMinutes))
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    drag.current = null
    setSpan(null)
    if (!state?.moved) return
    dragged.current = true
    onDraft({
      dayStart: day.start,
      ...dragSpan(
        state.downPx,
        offsetOf(e.clientY, e.currentTarget),
        blockMinutes,
      ),
    })
  }

  return (
    <div
      ref={setNodeRef}
      data-cal-day={day.start}
      data-cal-drop={dayId(day.start)}
      onClick={(e) => {
        if (dragged.current) {
          dragged.current = false
          return
        }
        if (e.target !== e.currentTarget) return
        const offset = e.clientY - e.currentTarget.getBoundingClientRect().top
        onDraft({
          dayStart: day.start,
          minute: slotMinute(offset, blockMinutes),
        })
      }}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={() => {
        drag.current = null
        setSpan(null)
      }}
      className={cn(
        'relative min-w-0 cursor-pointer border-l transition-colors',
        today && 'bg-signal/[0.03]',
        isOver && 'bg-accent/50',
      )}
      style={{
        height: 24 * hourPx,
        backgroundImage:
          blockMinutes < 60
            ? 'linear-gradient(to bottom, var(--border) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--border) 45%, transparent) 1px, transparent 1px)'
            : 'linear-gradient(to bottom, var(--border) 1px, transparent 1px)',
        backgroundSize:
          blockMinutes < 60
            ? `100% ${hourPx}px, 100% ${blockPx}px`
            : `100% ${hourPx}px`,
      }}
    >
      {day.timed.map((placed) => (
        <TimedEntryView
          key={entryKey(placed)}
          placed={placed}
          projects={projects}
          hourPx={hourPx}
          blockMinutes={blockMinutes}
        />
      ))}
      {today ? (
        <div
          className="pointer-events-none absolute inset-x-0 z-30 flex items-center"
          style={{ top: (minuteOfDay(now) / 60) * hourPx }}
        >
          <span className="-ml-1 size-2 rounded-full bg-signal" />
          <span className="h-px flex-1 bg-signal" />
        </div>
      ) : null}
      {span ? (
        <div
          className={DRAFT_BOX_CLASSES}
          style={{
            top: (span.minute / 60) * hourPx,
            height: (span.minutes / 60) * hourPx,
          }}
        >
          {`${timeLabel(span.minute)} – ${timeLabel(span.minute + span.minutes)}`}
        </div>
      ) : null}
      {draft !== null &&
      draft.dayStart === day.start &&
      draft.minute !== null ? (
        <DraftAnchor
          minute={draft.minute}
          minutes={draft.minutes ?? blockMinutes}
          hourPx={hourPx}
        />
      ) : null}
    </div>
  )
}

function QuickCreate({
  board,
  draft,
  blockMinutes,
  projectId,
  onProjectChange,
  onDone,
}: {
  board: BoardData
  draft: Draft
  blockMinutes: BlockMinutes
  projectId: string | null
  onProjectChange: (id: string) => void
  onDone: () => void
}) {
  const addTask = useAddTask()
  const spaceId = useBoardScope()
  const [title, setTitle] = useState('')
  const projects = activeProjects(board)
  const project =
    projects.find((p) => p.id === projectId) ?? projects.at(0) ?? null
  const dueAt = atMinute(draft.dayStart, draft.minute ?? 0)
  const minutes = draft.minute === null ? null : (draft.minutes ?? blockMinutes)
  // A task dropped on today is a commitment for today, so it starts focused.
  // Focus is personal only (the server refuses it in a space), hence the scope
  // gate.
  const inFocus = spaceId === null && isToday(draft.dayStart)

  if (!project)
    return (
      <p className="text-sm text-muted-foreground">
        Make a project on the board first. Tasks need a home.
      </p>
    )

  const submit = () => {
    const t = title.trim()
    if (!t) return
    addTask({
      id: newId(),
      projectId: project.id,
      title: t,
      position: positionAfter(project.tasks.filter((x) => !x.parentId)),
      dueAt,
      durationMinutes: minutes,
      createdFrom: 'calendar',
      inFocus: inFocus || undefined,
    })
    onDone()
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="flex flex-col gap-3"
    >
      <span className="os-label">
        {format(dueAt, 'EEE d MMM')}
        {draft.minute === null || minutes === null
          ? ' · all day'
          : ` · ${timeLabel(draft.minute)} – ${timeLabel(draft.minute + minutes)} · ${durationLabel(minutes)}`}
        {inFocus ? ' · will start focused' : ''}
      </span>
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add a task"
        aria-label="Task title"
      />
      <div className="flex items-center gap-2">
        <Select value={project.id} onValueChange={onProjectChange}>
          <SelectTrigger
            size="sm"
            data-proj={project.color}
            className="min-w-0 flex-1 text-xs"
            aria-label="Project"
          >
            <SelectValue>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="size-2 shrink-0 rounded-full bg-proj" />
                <span className="truncate">{project.name}</span>
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <span data-proj={p.color} className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-proj" />
                  {p.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" size="sm" disabled={!title.trim()}>
          Add
        </Button>
      </div>
    </form>
  )
}

function useSwipe(onSwipe: (direction: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number; dragged: boolean } | null>(null)
  useDndMonitor({
    onDragStart: () => {
      if (start.current) start.current.dragged = true
    },
  })
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const touch = e.touches[0]
      start.current = { x: touch.clientX, y: touch.clientY, dragged: false }
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const from = start.current
      start.current = null
      const touch = e.changedTouches[0]
      if (!from || from.dragged || !touch) return
      const dx = touch.clientX - from.x
      const dy = touch.clientY - from.y
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
      onSwipe(dx < 0 ? 1 : -1)
    },
  }
}

/** A stable React key across the two entry kinds: a task id and a Google event
 *  id never collide by construction. */
function entryKey(entry: TimedEntry): string {
  return entry.kind === 'task' ? entry.task.id : entry.event.eventId
}

export function CalendarView({
  board,
  showDone,
  blockMinutes,
  onBlockMinutesChange,
  active,
}: {
  board: BoardData
  showDone: boolean
  blockMinutes: BlockMinutes
  onBlockMinutesChange: (minutes: number) => void
  active: boolean
}) {
  const wide = useMediaQuery('(min-width: 768px)')
  const span = wide ? 7 : 3
  const [anchor, setAnchor] = useState(() => new Date())
  const [draft, setDraft] = useState<Draft | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrolledRef = useRef(false)
  const now = useNow()
  const hourPx = hourPxFor(blockMinutes)
  const step = labelStep(blockMinutes)
  const labelEvery = wide ? step : Math.max(step, 60)
  const labelMinutes = Array.from(
    { length: (24 * 60) / labelEvery - 1 },
    (_, index) => (index + 1) * labelEvery,
  )

  const days = visibleDays(anchor, span)
  const projects = activeProjects(board)
  // The backward feed is personal only: a space calendar renders the shared
  // board's tasks, and one member's Google calendar must not appear there.
  const spaceId = useBoardScope()
  const personal = spaceId === null
  const { events } = useBackwardSync(days, active && personal)
  const imported = importedEventIds(board)
  const feed = personal
    ? events.filter((event) => !imported.has(event.eventId))
    : []

  const week = calendarWeek(board, days, showDone, feed)
  const columns = {
    gridTemplateColumns: `${wide ? '4rem' : '3rem'} repeat(${span}, minmax(0, 1fr))`,
  }

  useEffect(() => {
    const el = scrollRef.current
    if (!active || !el || scrolledRef.current) return
    scrolledRef.current = true
    el.scrollTop = Math.max(0, new Date().getHours() - 2) * hourPx
  }, [active, hourPx])

  // Keep the same time of day in view when the grid resolution changes. The
  // scroll offset is captured before the new height lands, because the browser
  // clamps a shrinking scroll area to its new maximum on layout.
  const pendingScrollHour = useRef<number | null>(null)
  const changeBlock = (minutes: number) => {
    if (minutes === blockMinutes) return
    const el = scrollRef.current
    if (el) pendingScrollHour.current = el.scrollTop / hourPx
    onBlockMinutesChange(minutes)
  }
  useEffect(() => {
    const el = scrollRef.current
    const hour = pendingScrollHour.current
    if (!el || hour === null) return
    pendingScrollHour.current = null
    el.scrollTop = hour * hourPx
  }, [hourPx])

  const shift = (direction: 1 | -1) => {
    setDraft(null)
    setAnchor(addDays(anchor, direction * span))
  }
  const swipe = useSwipe(shift)

  return (
    <div className={cn('min-h-0 flex-1 flex-col', active ? 'flex' : 'hidden')}>
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 sm:px-4">
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          onClick={() => {
            setDraft(null)
            setAnchor(new Date())
          }}
        >
          Today
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7"
          aria-label={wide ? 'Previous week' : 'Previous days'}
          onClick={() => shift(-1)}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7"
          aria-label={wide ? 'Next week' : 'Next days'}
          onClick={() => shift(1)}
        >
          <ChevronRight className="size-4" />
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {weekLabel(days)}
        </h2>
        <Select
          value={String(blockMinutes)}
          onValueChange={(value) => changeBlock(Number(value))}
        >
          <SelectTrigger
            size="sm"
            className="h-7 w-auto shrink-0 gap-1 px-2 text-xs"
            aria-label="Calendar block size"
            title="Calendar block size"
          >
            <Grid2x2 className="hidden size-3.5 sm:block" />
            <span className="hidden text-muted-foreground sm:inline">
              Block
            </span>
            <SelectValue>{blockShortLabel(blockMinutes)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {BLOCK_MINUTES.map((minutes) => (
              <SelectItem key={minutes} value={String(minutes)}>
                {minutes >= 60 ? '1 hour' : `${minutes} minutes`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <CalendarSyncButton />
      </div>

      <Popover open={draft !== null} onOpenChange={(o) => !o && setDraft(null)}>
        <div
          ref={scrollRef}
          className="board-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden select-none"
          {...swipe}
        >
          <div className="pb-24 lg:pb-0">
            <div className="sticky top-0 z-40 bg-background">
              <div className="grid border-b" style={columns}>
                <span />
                {week.map((day) => (
                  <div
                    key={day.start}
                    className="flex flex-col items-center gap-0.5 border-l py-1.5"
                  >
                    <span className="os-label">{format(day.start, 'EEE')}</span>
                    <span
                      className={cn(
                        'flex size-7 items-center justify-center rounded-full text-sm font-semibold',
                        isToday(day.start) &&
                          'bg-signal text-signal-foreground',
                      )}
                    >
                      {format(day.start, 'd')}
                    </span>
                  </div>
                ))}
              </div>
              <div className="grid border-b" style={columns}>
                <span className="os-label self-center pr-1.5 text-right leading-tight">
                  all day
                </span>
                {week.map((day) => (
                  <AllDayCell
                    key={day.start}
                    day={day}
                    draft={draft}
                    onDraft={setDraft}
                    projects={projects}
                  />
                ))}
              </div>
            </div>

            <div className="grid" style={columns}>
              <div className="relative" style={{ height: 24 * hourPx }}>
                {labelMinutes.map((minute) => (
                  <span
                    key={minute}
                    className="absolute right-1.5 -translate-y-1/2 whitespace-nowrap font-mono text-[10px] text-muted-foreground"
                    style={{ top: (minute / 60) * hourPx }}
                  >
                    {timeLabel(minute)}
                  </span>
                ))}
              </div>
              {week.map((day) => (
                <DayColumn
                  key={day.start}
                  day={day}
                  now={now}
                  draft={draft}
                  blockMinutes={blockMinutes}
                  hourPx={hourPx}
                  onDraft={setDraft}
                  projects={projects}
                />
              ))}
            </div>
          </div>
        </div>
        <PopoverContent
          side={wide ? 'right' : 'bottom'}
          align={wide ? 'start' : 'center'}
          collisionPadding={12}
          className="w-[min(18rem,calc(100vw-1.5rem))] data-[state=closed]:animate-none!"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {draft ? (
            <QuickCreate
              key={`${draft.dayStart}:${draft.minute}:${draft.minutes ?? ''}`}
              board={board}
              draft={draft}
              blockMinutes={blockMinutes}
              projectId={projectId}
              onProjectChange={setProjectId}
              onDone={() => setDraft(null)}
            />
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  )
}
