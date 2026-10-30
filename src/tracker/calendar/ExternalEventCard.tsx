import { useEffect, useState } from 'react'
import { endOfDay } from 'date-fns/endOfDay'
import { format } from 'date-fns/format'
import { isSameDay } from 'date-fns/isSameDay'
import { subMilliseconds } from 'date-fns/subMilliseconds'
import { CalendarDays, ExternalLink, Plus } from 'lucide-react'

import { cn } from '#/design-system'
import { Button } from '#/design-system/ui/button'
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

import { minuteOfDay, timeLabel } from './calendar-logic'
import { positionAfter } from '../types'
import { useImportExternalEvent } from './pull'

import type { ExternalEvent, PlacedTask } from './calendar-logic'
import type { ProjectWithTasks } from '../types'

/**
 * Google's event, drawn in Life OS's own visual language. Everything is
 * deliberately the inverse of a task card: no drag, no resize, no project
 * color, dashed border and neutral fill where a task gets its color. It is
 * your calendar, shown here, not a plan yet. The one action it offers is the
 * explicit import, plus a link out to Google.
 */

const DAY_MS = 86_400_000

function dayTimeLabel(event: ExternalEvent): string {
  if (event.allDay) {
    const lastDay = subMilliseconds(endOfDay(event.end), 1)
    return isSameDay(event.start, lastDay)
      ? `All day · ${format(event.start, 'EEE d MMM')}`
      : `All day · ${format(event.start, 'd MMM')} – ${format(lastDay, 'd MMM')}`
  }
  const day = isSameDay(event.start, event.end)
    ? format(event.start, 'EEE d MMM')
    : `${format(event.start, 'EEE d MMM')} – ${format(event.end, 'EEE d MMM')}`
  const endMinute = isSameDay(event.start, event.end)
    ? minuteOfDay(event.end)
    : 23 * 60 + 59
  return `${day} · ${timeLabel(minuteOfDay(event.start))} – ${timeLabel(endMinute)}`
}

function ImportPopover({
  event,
  projects,
  onDone,
}: {
  event: ExternalEvent
  projects: Array<ProjectWithTasks>
  onDone: () => void
}) {
  const importEvent = useImportExternalEvent()
  const [chosen, setChosen] = useState<string | null>(
    projects.at(0)?.id ?? null,
  )
  const project =
    projects.find((p) => p.id === chosen) ?? projects.at(0) ?? null

  useEffect(() => {
    if (!importEvent.isSuccess) return
    onDone()
  }, [importEvent.isSuccess, onDone])

  if (!project)
    return (
      <p className="text-sm text-muted-foreground">
        Make a project on the board first. Tasks need a home.
      </p>
    )

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    importEvent.mutate({
      event,
      taskId: globalThis.crypto.randomUUID(),
      projectId: project.id,
      position: positionAfter(project.tasks.filter((x) => !x.parentId)),
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <CalendarDays className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="break-words text-sm font-medium leading-snug">
            {event.title}
          </p>
          <p className="text-xs text-muted-foreground">{dayTimeLabel(event)}</p>
          {event.location ? (
            <p className="truncate text-xs text-muted-foreground">
              {event.location}
            </p>
          ) : null}
          {event.notes ? (
            <p className="line-clamp-3 pt-1 text-xs leading-snug text-muted-foreground">
              {event.notes}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Select value={project.id} onValueChange={setChosen}>
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
        <Button type="submit" size="sm" disabled={importEvent.isPending}>
          <Plus className="size-3.5" />
          Add as task
        </Button>
      </div>
      {event.link ? (
        <a
          href={event.link}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ExternalLink className="size-3" />
          Open in Google Calendar
        </a>
      ) : null}
    </form>
  )
}

/** One popover per card, triggered by the card itself, as the sync control
 *  does — never one shared popover with a moving anchor, the pattern that
 *  makes floating UI jump (see docs/ui-guidelines.md). The content closes
 *  with no exit animation because the trigger unmounts when an import
 *  removes the card from the grid. */
function ExternalEventPopover({
  event,
  projects,
  children,
  className,
}: {
  event: ExternalEvent
  projects: Array<ProjectWithTasks>
  children: React.ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          className={cn('h-full cursor-pointer', className)}
        >
          {children}
        </div>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        collisionPadding={12}
        className="w-[min(18rem,calc(100vw-1.5rem))] data-[state=closed]:animate-none!"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <ImportPopover
          event={event}
          projects={projects}
          onDone={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}

/** The dashed, colourless skin every external card wears, in both grid modes. */
export function externalCardClassName(compact?: boolean): string {
  return cn(
    'flex h-full min-w-0 flex-col overflow-hidden rounded-md border border-dashed bg-accent/20 px-1.5 text-left text-foreground/75 transition-colors hover:bg-accent/30',
    compact ? 'py-0.5' : 'py-1',
  )
}

export function ExternalEventCard({
  event,
  placed,
  compact,
  projects,
}: {
  event: ExternalEvent
  placed?: PlacedTask
  compact?: boolean
  projects: Array<ProjectWithTasks>
}) {
  return (
    <ExternalEventPopover event={event} projects={projects}>
      <div className={externalCardClassName(compact)} title={event.title}>
        <span className="truncate text-xs font-medium leading-tight">
          {event.title}
        </span>
        {!compact ? (
          <span className="truncate font-mono text-[10px] leading-tight text-foreground/60">
            {placed
              ? timeLabel(placed.start)
              : `${timeLabel(minuteOfDay(event.start))} – ${timeLabel(event.end < event.start + DAY_MS ? minuteOfDay(event.end) : 23 * 60 + 59)}`}
          </span>
        ) : null}
      </div>
    </ExternalEventPopover>
  )
}
