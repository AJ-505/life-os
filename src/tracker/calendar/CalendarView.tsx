import { useEffect, useRef, useState } from 'react'
import { useDndMonitor, useDraggable, useDroppable } from '@dnd-kit/core'
import { addDays } from 'date-fns/addDays'
import { format } from 'date-fns/format'
import { isSameMonth } from 'date-fns/isSameMonth'
import { isToday } from 'date-fns/isToday'
import { ChevronLeft, ChevronRight, Flag } from 'lucide-react'

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
import { useAddTask, useUpdateTask } from '../queries'
import { activeProjects } from '../board/board-logic'
import { useBoardUI } from '../board/board-ui'
import {
  EVENT_MINUTES,
  HOUR_PX,
  allDayId,
  atMinute,
  calTaskId,
  calendarWeek,
  dayId,
  minuteOfDay,
  resizedMinutes,
  visibleDays,
} from './calendar-logic'

import type { CalendarDay, CalendarTask, PlacedTask } from './calendar-logic'
import type { BoardData, Project, Task } from '../types'

type Draft = { dayStart: number; minute: number | null }

export function calendarSlotAt(point: { x: number; y: number }) {
  const hit = document.elementFromPoint(point.x, point.y)
  return hit?.closest<HTMLElement>('[data-cal-drop]')?.dataset.calDrop ?? null
}

const HOURS = Array.from({ length: 24 }, (_, h) => h)

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

function timeLabel(minute: number) {
  return format(atMinute(0, minute), minute % 60 === 0 ? 'h a' : 'h:mm a')
}

export function CalendarEventCard({
  task,
  project,
  compact,
  dragging,
}: {
  task: Task
  project: Project
  compact?: boolean
  dragging?: boolean
}) {
  return (
    <div
      data-proj={project.color}
      className={cn(
        '@container flex h-full min-w-0 flex-col overflow-hidden rounded-md border-l-2 border-proj bg-proj/15 px-1.5 text-left text-proj transition-colors hover:bg-proj/25',
        compact ? 'py-0.5' : 'py-1',
        task.done && 'opacity-55',
        dragging && 'bg-proj/30 shadow-lg ring-2 ring-signal/40',
      )}
    >
      <span
        className={cn(
          'truncate text-xs font-medium leading-tight text-foreground @max-[5.5rem]:line-clamp-2 @max-[5.5rem]:whitespace-normal @max-[5.5rem]:[overflow-wrap:anywhere]',
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
  className,
  style,
  children,
}: {
  entry: CalendarTask
  compact?: boolean
  className?: string
  style?: React.CSSProperties
  children?: React.ReactNode
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
      />
      {children}
    </button>
  )
}

function ResizeHandle({
  placed,
  onLive,
}: {
  placed: PlacedTask
  onLive: (minutes: number | null) => void
}) {
  const updateTask = useUpdateTask()
  const drag = useRef<{ y: number; minutes: number } | null>(null)

  const minutesAt = (clientY: number) =>
    resizedMinutes(
      placed.start,
      placed.minutes,
      clientY - (drag.current?.y ?? clientY),
    )

  return (
    <div
      role="separator"
      aria-label="Resize event"
      className="absolute inset-x-1 bottom-0 z-10 hidden h-2 cursor-ns-resize touch-none items-end justify-center [@media(pointer:fine)]:flex"
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
        onLive(null)
        if (minutes !== placed.minutes)
          updateTask.mutate({ id: placed.task.id, durationMinutes: minutes })
      }}
      onPointerCancel={() => {
        drag.current = null
        onLive(null)
      }}
    >
      <span className="mb-0.5 h-0.5 w-6 rounded-full bg-foreground/30" />
    </div>
  )
}

function TimedTask({ placed }: { placed: PlacedTask }) {
  const [live, setLive] = useState<number | null>(null)
  const minutes = live ?? placed.minutes

  return (
    <DraggableTask
      entry={placed}
      className="absolute z-10 p-px"
      style={{
        top: (placed.start / 60) * HOUR_PX,
        height: (minutes / 60) * HOUR_PX,
        left: `${(placed.lane / placed.lanes) * 100}%`,
        width: `${100 / placed.lanes}%`,
      }}
    >
      <ResizeHandle placed={placed} onLive={setLive} />
    </DraggableTask>
  )
}

function DraftAnchor({ minute }: { minute: number | null }) {
  if (minute === null)
    return (
      <PopoverAnchor className="h-5 rounded-md border border-dashed border-signal/60 bg-signal/10" />
    )
  return (
    <PopoverAnchor
      className="pointer-events-none absolute inset-x-0 z-20 rounded-md border border-dashed border-signal/60 bg-signal/10 px-1.5 py-1 font-mono text-[10px] text-signal"
      style={{
        top: (minute / 60) * HOUR_PX,
        height: (EVENT_MINUTES / 60) * HOUR_PX,
      }}
    >
      {timeLabel(minute)}
    </PopoverAnchor>
  )
}

function AllDayCell({
  day,
  draft,
  onDraft,
}: {
  day: CalendarDay
  draft: Draft | null
  onDraft: (draft: Draft) => void
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
      {draft?.dayStart === day.start && draft.minute === null ? (
        <DraftAnchor minute={null} />
      ) : null}
    </div>
  )
}

function DayColumn({
  day,
  now,
  draft,
  onDraft,
}: {
  day: CalendarDay
  now: number
  draft: Draft | null
  onDraft: (draft: Draft) => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: dayId(day.start),
    data: { type: 'day' },
  })
  const today = isToday(day.start)

  return (
    <div
      ref={setNodeRef}
      data-cal-day={day.start}
      data-cal-drop={dayId(day.start)}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return
        const offset = e.clientY - e.currentTarget.getBoundingClientRect().top
        const minute = Math.floor((offset / HOUR_PX) * 2) * 30
        onDraft({ dayStart: day.start, minute: Math.min(minute, 23 * 60) })
      }}
      className={cn(
        'relative min-w-0 cursor-pointer border-l transition-colors',
        today && 'bg-signal/[0.03]',
        isOver && 'bg-accent/50',
      )}
      style={{
        height: 24 * HOUR_PX,
        backgroundImage:
          'linear-gradient(to bottom, var(--border) 1px, transparent 1px)',
        backgroundSize: `100% ${HOUR_PX}px`,
      }}
    >
      {day.timed.map((placed) => (
        <TimedTask key={placed.task.id} placed={placed} />
      ))}
      {today ? (
        <div
          className="pointer-events-none absolute inset-x-0 z-30 flex items-center"
          style={{ top: (minuteOfDay(now) / 60) * HOUR_PX }}
        >
          <span className="-ml-1 size-2 rounded-full bg-signal" />
          <span className="h-px flex-1 bg-signal" />
        </div>
      ) : null}
      {draft?.dayStart === day.start && draft.minute !== null ? (
        <DraftAnchor minute={draft.minute} />
      ) : null}
    </div>
  )
}

function QuickCreate({
  board,
  draft,
  projectId,
  onProjectChange,
  onDone,
}: {
  board: BoardData
  draft: Draft
  projectId: string | null
  onProjectChange: (id: string) => void
  onDone: () => void
}) {
  const addTask = useAddTask()
  const [title, setTitle] = useState('')
  const projects = activeProjects(board)
  const project =
    projects.find((p) => p.id === projectId) ?? projects.at(0) ?? null
  const dueAt = atMinute(draft.dayStart, draft.minute ?? 0)

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
        {draft.minute === null ? ' · all day' : ` · ${timeLabel(draft.minute)}`}
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

export function CalendarView({
  board,
  showDone,
  active,
}: {
  board: BoardData
  showDone: boolean
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

  const days = visibleDays(anchor, span)
  const week = calendarWeek(board, days, showDone)
  const columns = {
    gridTemplateColumns: `${wide ? '4rem' : '3rem'} repeat(${span}, minmax(0, 1fr))`,
  }

  useEffect(() => {
    const el = scrollRef.current
    if (!active || !el || scrolledRef.current) return
    scrolledRef.current = true
    el.scrollTop = Math.max(0, new Date().getHours() - 2) * HOUR_PX
  }, [active])

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
        <h2 className="min-w-0 truncate text-sm font-semibold">
          {weekLabel(days)}
        </h2>
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
                  />
                ))}
              </div>
            </div>

            <div className="grid" style={columns}>
              <div className="relative" style={{ height: 24 * HOUR_PX }}>
                {HOURS.slice(1).map((h) => (
                  <span
                    key={h}
                    className="absolute right-1.5 -translate-y-1/2 font-mono text-[10px] text-muted-foreground"
                    style={{ top: h * HOUR_PX }}
                  >
                    {timeLabel(h * 60)}
                  </span>
                ))}
              </div>
              {week.map((day) => (
                <DayColumn
                  key={day.start}
                  day={day}
                  now={now}
                  draft={draft}
                  onDraft={setDraft}
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
              key={`${draft.dayStart}:${draft.minute}`}
              board={board}
              draft={draft}
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
