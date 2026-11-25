import { useState } from 'react'
import { format } from 'date-fns/format'
import {
  Archive,
  CalendarIcon,
  Crosshair,
  History,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { cn, ComingSoon } from '#/design-system'
import { CALENDAR_ENABLED } from '#/feature-flags'
import { Button } from '#/design-system/ui/button'
import { Calendar } from '#/design-system/ui/calendar'
import { Checkbox } from '#/design-system/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  calendarSwitch,
  syncIssueNote,
  useCalendarSync,
} from '#/settings/calendar-sync'
import { useSpaceMembers } from '#/spaces/queries'
import { AssigneeSelect } from '#/spaces/components/AssigneeSelect'

import { REMINDER_CHOICES } from '../../../convex/syncRule'
import { DEFAULT_EVENT_MINUTES } from '../../../convex/taskModel'
import { isRepeatRule, REPEAT_RULES } from '../../../convex/recurrence'
import { useBoardScope } from '../board-scope'
import { canvasProjects } from './board-logic'
import { appendFocusOrder, appendRootPosition } from './placement'
import { useTaskEditSession } from './task-edit-session'
import { NO_PROJECT_ID } from '../types'
import { durationUntil, minuteOfDay } from '../calendar/calendar-logic'
import {
  DEFAULT_DUE_TIME,
  formatTime24,
  isAllDay,
  parseTime24,
  withTime,
} from '../due'
import {
  taskHistoryQueryOptions,
  useDeleteTask,
  useMoveTask,
  useSetTaskFocus,
  useUpdateTask,
} from '../queries'

import type { RepeatRule } from '../../../convex/recurrence'
import type { TaskUpdate } from '../../../convex/taskModel'
import type { BoardData, Task } from '../types'

type Session = ReturnType<typeof useTaskEditSession>

const REPEAT_LABELS: Record<RepeatRule, string> = {
  daily: 'Every day',
  weekdays: 'Every weekday',
  weekly: 'Every week',
  monthly: 'Every month',
  yearly: 'Every year',
}

function Subtasks({ session }: { session: Session }) {
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const children = session.subtasks

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="os-label">
        Subtasks
        {children.length > 0
          ? ` · ${children.filter((c) => c.done).length}/${children.length}`
          : ''}
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
            <input
              value={session.subtaskTitle(c)}
              onChange={(e) => session.editSubtask(c.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                e.currentTarget.blur()
              }}
              aria-label="Subtask title"
              className={cn(
                'min-w-0 flex-1 bg-transparent py-0.5 text-sm outline-none',
                c.done &&
                  'text-muted-foreground line-through decoration-border',
              )}
            />
            <button
              type="button"
              aria-label="Delete subtask"
              onClick={() => deleteTask.mutate({ id: c.id })}
              className="shrink-0 cursor-pointer text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          session.addSubtask()
        }}
        className="flex items-center gap-1.5 px-1"
      >
        <Plus className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          value={session.view.newSubtask}
          onChange={(e) => session.edit({ newSubtask: e.target.value })}
          enterKeyHint="done"
          placeholder="Add a subtask"
          className="w-full bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground/70"
        />
        <button
          type="submit"
          aria-label="Add subtask"
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-4" />
        </button>
      </form>
    </div>
  )
}

function TaskCalendarFields({
  task,
  session,
}: {
  task: Task
  session: Session
}) {
  const sync = useCalendarSync()
  const { view } = session
  const reminder = view.reminderMinutes ?? sync.defaultReminder
  const toggle = calendarSwitch(sync, {
    ...task,
    dueAt: view.dueAt,
    addToCalendar: view.addToCalendar,
  })
  const issue = task.calendarSyncIssue

  return (
    <div className="flex flex-col gap-2 rounded-md border px-3 py-2.5">
      {issue && toggle.showsIssue ? (
        <p role="status" className="text-xs leading-snug text-destructive">
          {syncIssueNote(issue)}
        </p>
      ) : null}
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <Switch
            checked={toggle.checked}
            disabled={toggle.disabled}
            onCheckedChange={(addToCalendar) => session.edit({ addToCalendar })}
          />
          <Label className="text-sm font-medium">Add to calendar</Label>
        </span>
        <span className="text-xs text-muted-foreground">{toggle.hint}</span>
      </div>
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Reminder</Label>
        <Select
          value={String(reminder)}
          onValueChange={(value) =>
            session.edit({ reminderMinutes: Number(value) })
          }
        >
          <SelectTrigger size="sm" className="w-[180px] text-xs">
            <SelectValue>{`${reminder} minutes before`}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {REMINDER_CHOICES.map((minutes) => (
              <SelectItem key={minutes} value={String(minutes)}>
                {minutes} minutes before
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function HistoryFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex flex-col gap-2 border-t pt-3"
      aria-label="Task history"
    >
      <div className="flex items-center gap-2">
        <History className="size-3.5 text-muted-foreground" />
        <span className="os-label">Task history</span>
      </div>
      {children}
    </div>
  )
}

function TaskHistoryPanel({ taskId }: { taskId: string }) {
  const {
    data: history = [],
    isPending,
    isError,
    refetch,
  } = useQuery(taskHistoryQueryOptions(taskId))
  if (isPending) {
    return (
      <HistoryFrame>
        <p className="text-xs text-muted-foreground">Loading history…</p>
      </HistoryFrame>
    )
  }
  if (isError) {
    return (
      <HistoryFrame>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          Could not load history.
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => void refetch()}
          >
            Try again
          </button>
        </p>
      </HistoryFrame>
    )
  }
  if (history.length === 0) {
    return (
      <HistoryFrame>
        <p className="text-xs text-muted-foreground">No history yet.</p>
      </HistoryFrame>
    )
  }
  const describe = (event: (typeof history)[number]) => {
    switch (event.kind) {
      case 'created':
        return 'created this task'
      case 'assigned':
        return `assigned this to ${event.toName ?? 'a member'}`
      case 'unassigned':
        return `removed ${event.fromName ?? 'the previous assignee'}`
      case 'completed':
        return 'closed this task'
      case 'reopened':
        return 'reopened this task'
      case 'archived':
        return 'archived this task'
      case 'unarchived':
        return 'restored this task'
      case 'moved':
        return 'moved this task to another project'
      case 'updated':
        return 'updated the task details'
    }
  }
  return (
    <HistoryFrame>
      <ol className="flex flex-col gap-2">
        {history.map((event) => (
          <li key={event.id} className="flex items-start gap-2 text-xs">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-signal" />
            <div className="min-w-0 flex-1">
              <p>
                <span className="font-medium">{event.actorName}</span>{' '}
                {describe(event)}
              </p>
              <time className="font-mono text-[10px] text-muted-foreground">
                {format(new Date(event.createdAt), 'd MMM yyyy · h:mm a')}
              </time>
            </div>
          </li>
        ))}
      </ol>
    </HistoryFrame>
  )
}

export function TaskDetails({
  task,
  board,
  onClose,
}: {
  task: Task
  board: BoardData
  onClose: () => void
}) {
  const session = useTaskEditSession(task, board)
  const { view } = session
  const updateTask = useUpdateTask()
  const moveTask = useMoveTask()
  const setFocus = useSetTaskFocus()
  const deleteTask = useDeleteTask()
  const { spaceId, can } = useBoardScope()
  const members = useSpaceMembers(can.assign ? spaceId : null)
  const queryClient = useQueryClient()

  const [dueOpen, setDueOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const timeOf = (dueAt: number | null) =>
    dueAt ? formatTime24(dueAt) : DEFAULT_DUE_TIME
  const [timeText, setTimeText] = useState(() => timeOf(view.dueAt))
  const [shownDueAt, setShownDueAt] = useState(view.dueAt)
  if (shownDueAt !== view.dueAt) {
    setShownDueAt(view.dueAt)
    setTimeText(timeOf(view.dueAt))
  }
  const [endDraft, setEndDraft] = useState<string | null>(null)
  const [endRejected, setEndRejected] = useState(false)

  const prefetchHistory = () => {
    void queryClient.prefetchQuery(taskHistoryQueryOptions(task.id))
  }

  const project = board.find((p) => p.id === task.projectId)
  const homes = canvasProjects(board)
  const projectName =
    homes.find((p) => p.id === task.projectId)?.name ?? 'No project'
  const canLeaveProject =
    task.dueAt !== null || task.projectId === NO_PROJECT_ID

  const timedStart =
    view.dueAt !== null && !isAllDay(view.dueAt) ? view.dueAt : null
  const endText =
    timedStart === null
      ? ''
      : formatTime24(
          timedStart + (view.durationMinutes ?? DEFAULT_EVENT_MINUTES) * 60_000,
        )

  const commitEnd = () => {
    const parsed = endDraft === null ? null : parseTime24(endDraft)
    setEndDraft(null)
    if (!parsed || timedStart === null) {
      setEndRejected(endDraft !== null && endDraft !== endText)
      return
    }
    const minutes = durationUntil(
      minuteOfDay(timedStart),
      parsed.h * 60 + parsed.m,
    )
    setEndRejected(minutes === null)
    if (minutes !== null) session.edit({ durationMinutes: minutes })
  }

  const commitTime = () => {
    const parsed = parseTime24(timeText)
    if (!parsed) {
      setTimeText(timeOf(view.dueAt))
      return
    }
    const formatted = `${String(parsed.h).padStart(2, '0')}:${String(parsed.m).padStart(2, '0')}`
    setTimeText(formatted)
    if (view.dueAt) session.edit({ dueAt: withTime(view.dueAt, formatted) })
  }

  const clearDate = () => {
    setDueOpen(false)
    session.edit({ dueAt: null, repeat: null })
  }

  const save = (extra?: TaskUpdate) => {
    session.commit(extra)
    onClose()
  }

  const toggleFocus = () =>
    setFocus.mutate({
      id: task.id,
      inFocus: !task.inFocus,
      focusOrder: appendFocusOrder(board, task.id),
    })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="max-w-md"
        data-proj={project?.color}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          const title = e.currentTarget
          if (!(title instanceof HTMLElement)) return
          const input = title.querySelector<HTMLInputElement>(
            'input[aria-label="Task title"]',
          )
          input?.focus()
          input?.select()
        }}
      >
        <DialogHeader>
          <DialogTitle className="sr-only">Task details</DialogTitle>
          <DialogDescription className="sr-only">
            Edit this task's title, notes, due date, project, subtasks, and
            focus state.
          </DialogDescription>
          <div className="flex items-center justify-between gap-3 pr-7">
            <span className="os-label flex min-w-0 items-center gap-1.5">
              <span className="size-2 shrink-0 rounded-full bg-proj" />
              <span className="truncate">{project?.name}</span>
            </span>
            <label className="flex min-h-9 shrink-0 cursor-pointer items-center gap-2 rounded-md border border-border px-2.5 text-xs">
              <Checkbox
                checked={task.done}
                onCheckedChange={(checked) =>
                  updateTask.mutate({ id: task.id, done: checked === true })
                }
                aria-label={task.done ? 'Mark not complete' : 'Mark complete'}
                className="rounded-full"
              />
              {task.done ? 'Completed' : 'Mark complete'}
            </label>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Input
            value={view.title}
            onChange={(e) => session.edit({ title: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            className="h-auto border-0 border-b border-border bg-input/30 px-2 py-2 text-base font-medium shadow-none focus-visible:ring-0"
            aria-label="Task title"
          />

          <Textarea
            value={view.notes}
            onChange={(e) => session.edit({ notes: e.target.value })}
            placeholder="Notes…"
            rows={4}
            spellCheck={false}
            className="field-sizing-fixed max-h-64 resize-y"
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label className="os-label">Due</Label>
              <div className="flex items-center gap-1.5">
                <Popover open={dueOpen} onOpenChange={setDueOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        'w-[9.5rem] justify-start gap-2 font-mono text-xs',
                        !view.dueAt && 'text-muted-foreground',
                      )}
                    >
                      <CalendarIcon className="size-3.5" />
                      {view.dueAt
                        ? format(new Date(view.dueAt), 'd MMM yyyy')
                        : 'No date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-auto p-0"
                    align="start"
                    side="bottom"
                    sideOffset={4}
                  >
                    <Calendar
                      mode="single"
                      selected={view.dueAt ? new Date(view.dueAt) : undefined}
                      onSelect={(day) => {
                        if (!day) return clearDate()
                        setDueOpen(false)
                        session.edit({ dueAt: withTime(day, timeText) })
                      }}
                    />
                    <div className="border-t p-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        disabled={!view.dueAt}
                        onClick={clearDate}
                      >
                        Clear date
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
                <Input
                  value={timeText}
                  disabled={!view.dueAt}
                  onChange={(e) => {
                    let next = e.target.value.replace(/[^0-9:]/g, '')
                    if (
                      next.length === 2 &&
                      timeText.length === 1 &&
                      !next.includes(':')
                    )
                      next = `${next}:`
                    setTimeText(next.slice(0, 5))
                  }}
                  onBlur={commitTime}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                  }}
                  placeholder="HH:MM"
                  className="h-8 w-[5.5rem] border-input bg-transparent px-2 font-mono text-xs shadow-xs"
                  aria-label="Due time 24h"
                />
              </div>
              {timedStart !== null ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Label
                    htmlFor="task-end-time"
                    className="os-label w-[9.5rem]"
                  >
                    Ends
                  </Label>
                  <Input
                    id="task-end-time"
                    value={endDraft ?? endText}
                    inputMode="numeric"
                    aria-invalid={endRejected}
                    onChange={(e) => {
                      setEndRejected(false)
                      setEndDraft(
                        e.target.value.replace(/[^0-9:]/g, '').slice(0, 5),
                      )
                    }}
                    onBlur={commitEnd}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                    placeholder="HH:MM"
                    className="h-8 w-[5.5rem] border-input bg-transparent px-2 font-mono text-xs shadow-xs"
                    aria-label="End time 24h"
                  />
                  {endRejected ? (
                    <span role="alert" className="text-xs text-destructive">
                      End must be after the start
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="os-label">Repeat</Label>
              <Select
                value={view.repeat ?? 'none'}
                onValueChange={(value) =>
                  session.edit({ repeat: isRepeatRule(value) ? value : null })
                }
                disabled={view.dueAt === null}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full text-xs"
                  aria-label="Repeat"
                >
                  <SelectValue>
                    {view.repeat === null ? 'None' : REPEAT_LABELS[view.repeat]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {REPEAT_RULES.map((rule) => (
                    <SelectItem key={rule} value={rule}>
                      {REPEAT_LABELS[rule]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {view.dueAt === null ? (
                <p className="text-[11px] text-muted-foreground">
                  Set a date to repeat.
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="os-label">Project</Label>
              <Select
                value={task.projectId}
                onValueChange={(projectId) => {
                  if (projectId === task.projectId) return
                  moveTask.mutate({
                    id: task.id,
                    projectId,
                    position: appendRootPosition(
                      board.find((p) => p.id === projectId),
                    ),
                  })
                }}
              >
                <SelectTrigger size="sm" className="w-full text-xs">
                  <SelectValue>{projectName}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {canLeaveProject ? (
                    <SelectItem value={NO_PROJECT_ID}>No project</SelectItem>
                  ) : null}
                  {homes.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {can.assign ? (
            <div className="flex flex-col gap-1.5">
              <Label className="os-label">Assignee</Label>
              <AssigneeSelect
                assigneeId={task.assigneeId}
                members={members}
                onAssign={(assigneeId) =>
                  updateTask.mutate({ id: task.id, assigneeId })
                }
              />
              <p className="text-[11px] text-muted-foreground">
                Every space member can assign or take this task.
              </p>
            </div>
          ) : null}

          {historyOpen ? <TaskHistoryPanel taskId={task.id} /> : null}

          {!CALENDAR_ENABLED ? (
            <ComingSoon
              title="Calendar sync"
              description="Google Calendar integration is on its way."
            />
          ) : can.calendar ? (
            <TaskCalendarFields task={task} session={session} />
          ) : (
            <ComingSoon
              status="Personal only"
              title="Calendar sync"
              description="Google Calendar sync runs on your own board, not on a shared one."
            />
          )}

          <Subtasks session={session} />

          {can.focus ? (
            <div
              role="switch"
              aria-checked={task.inFocus}
              aria-label="In focus"
              tabIndex={0}
              onClick={toggleFocus}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault()
                  toggleFocus()
                }
              }}
              className="flex cursor-pointer items-center justify-between rounded-md border px-3 py-2 transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
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
                tabIndex={-1}
                aria-hidden
                className="pointer-events-none"
              />
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground"
              onClick={() => save({ archived: !task.archived })}
            >
              <Archive className="size-3.5" />
              {task.archived ? 'Unarchive' : 'Archive'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={() => {
                onClose()
                deleteTask.mutate({ id: task.id })
              }}
            >
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            {can.history ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onPointerEnter={prefetchHistory}
                onFocus={prefetchHistory}
                onClick={() => setHistoryOpen((open) => !open)}
              >
                <History className="size-3.5" />
                {historyOpen ? 'Hide history' : 'History'}
              </Button>
            ) : null}
            <Button size="sm" onClick={() => save()}>
              Done
            </Button>
          </div>
        </DialogFooter>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
        >
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </button>
      </DialogContent>
    </Dialog>
  )
}
