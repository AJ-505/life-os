import { useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { format } from 'date-fns'
import { Archive, CalendarIcon, Crosshair, Plus, Trash2, X } from 'lucide-react'

import { cn, ComingSoon } from '#/design-system'
import { CALENDAR_ENABLED } from '#/feature-flags'
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
import { useQuery } from '@tanstack/react-query'
import { calendarSettingsQueryOptions } from '#/settings/queries'
import { useGoogleCalendar, useSyncTaskToCalendar } from '#/settings/googleCalendar'
import { toast } from 'sonner'

import type { BoardData, Task } from '../types'

/**
 * Capture-now / write-later. Optimistic board patches must not run in the same
 * turn as dialog unmount — React batches them and Done waits on a full board
 * reconcile. Call the outer fn while the DOM is still up; run the thunk after
 * onClose (setTimeout 0).
 */
type DeferredWrite = () => void
type CaptureWrite = () => DeferredWrite | null
type PendingWrites = {
  fields: { title: string; notes: string }
  subtask: DeferredWrite | null
  draft: DeferredWrite | null
}

function Subtasks({
  parent,
  board,
  closingRef,
  draftCaptureRef,
}: {
  parent: Task
  board: BoardData
  closingRef: MutableRefObject<boolean>
  draftCaptureRef: MutableRefObject<CaptureWrite | null>
}) {
  const createTask = useCreateTask()
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const draftRef = useRef<HTMLInputElement>(null)

  const project = board.find((p) => p.id === parent.projectId)
  const children = (project?.tasks ?? [])
    .filter((t) => t.parentId === parent.id && !t.archived)
    .sort((a, b) => a.position - b.position)
  const childrenRef = useRef(children)
  // Effect, not render-time assignment: writing a ref during render opts the
  // whole component out of React Compiler memoization.
  useEffect(() => {
    childrenRef.current = children
  })

  const commitDraft = (title: string) => {
    createTask.mutate({
      id: newId(),
      projectId: parent.projectId,
      parentId: parent.id,
      title,
      position: positionAfter(childrenRef.current),
    })
  }

  const takeDraft = (): string => {
    const t = draftRef.current?.value.trim() ?? ''
    if (draftRef.current) draftRef.current.value = ''
    return t
  }

  const add = () => {
    const t = takeDraft()
    if (t) commitDraft(t)
  }

  // Armed in an effect (not during render) for the same compiler reason as
  // childrenRef above. The closure only reads live refs/DOM at call time, so
  // running post-commit never serves a stale draft.
  useEffect(() => {
    draftCaptureRef.current = () => {
      const t = takeDraft()
      if (!t) return null
      return () => commitDraft(t)
    }
  })

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
              key={c.id}
              defaultValue={c.title}
              data-subtask-id={c.id}
              data-subtask-was={c.title}
              onBlur={(e) => {
                const next = e.currentTarget.value.trim()
                if (!next) {
                  e.currentTarget.value = c.title
                  return
                }
                if (next === c.title) return
                // Defer so a close that arms on the same turn can suppress this
                // write and own it after unmount (no board patch mid-dismiss).
                const id = c.id
                setTimeout(() => {
                  if (closingRef.current) return
                  updateTask.mutate({ id, title: next })
                }, 0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  ;(e.target as HTMLInputElement).blur()
                }
              }}
              aria-label="Subtask title"
              className={cn(
                'min-w-0 flex-1 bg-transparent py-0.5 text-sm outline-none',
                c.done && 'text-muted-foreground line-through decoration-border',
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
          add()
        }}
        className="flex items-center gap-1.5 px-1"
      >
        <Plus className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={draftRef}
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

  // Title/notes are uncontrolled (committed on blur/close). Controlled state
  // re-rendered the whole dialog on every keystroke, which made typing in the
  // notes field visibly lag.
  const titleRef = useRef<HTMLInputElement>(null)
  const notesRef = useRef<HTMLTextAreaElement>(null)
  const closingRef = useRef(false)
  const pendingRef = useRef<PendingWrites | null>(null)
  const draftCaptureRef = useRef<CaptureWrite | null>(null)
  const [dueOpen, setDueOpen] = useState(false)

  const project = board.find((p) => p.id === task.projectId)
  const activeProjects = board.filter((p) => p.status === 'active')
  const { data: calendarSettings } = useQuery(calendarSettingsQueryOptions)
  const { connection } = useGoogleCalendar()
  const syncToCalendar = useSyncTaskToCalendar()
  const calendarReady =
    connection.status === 'connected' && (calendarSettings?.syncEnabled ?? false)
  const defaultReminder = calendarSettings?.defaultReminderMinutes ?? 15

  // Local 24h time + due state — committed only on Done (optimistic close, single toast)
  const [localDueAt, setLocalDueAt] = useState<number | null>(task.dueAt ?? null)
  const [localReminder, setLocalReminder] = useState<number>(
    task.reminderMinutes ?? defaultReminder,
  )
  // The toggle reflects stored intent. It used to be derived from
  // `!!task.calendarEventId`, which the board never returned, so it read false
  // on every open no matter what the user had saved.
  const [localAddToCal, setLocalAddToCal] = useState<boolean>(task.addToCalendar)
  const [timeInput, setTimeInput] = useState<string>(() =>
    task.dueAt ? format(new Date(task.dueAt), 'HH:mm') : '09:00',
  )
  useEffect(() => {
    setLocalDueAt(task.dueAt ?? null)
    setLocalReminder(task.reminderMinutes ?? defaultReminder)
    setLocalAddToCal(task.addToCalendar)
    setTimeInput(task.dueAt ? format(new Date(task.dueAt), 'HH:mm') : '09:00')
  }, [
    task.id,
    task.dueAt,
    task.reminderMinutes,
    task.addToCalendar,
    defaultReminder,
  ])

  // Says which of the three preconditions is actually missing, rather than
  // "Connect calendar first" for all of them.
  const calendarHint = !calendarSettings?.syncEnabled
    ? 'Turn on calendar sync in Settings'
    : connection.status === 'needs_scope'
      ? 'Reconnect Google to grant calendar access'
      : connection.status !== 'connected'
        ? 'Connect Google in Settings'
        : !localDueAt
          ? 'Set a date first'
          : ''

  const parseTime24 = (s: string): { h: number; m: number } | null => {
    const m = s.trim().match(/^(\d{1,2}):(\d{2})$/)
    if (!m) return null
    const h = Number(m[1]); const min = Number(m[2])
    if (h < 0 || h > 23 || min < 0 || min > 59) return null
    return { h, m: min }
  }
  const applyTimeToLocal = (timeStr: string) => {
    if (!localDueAt) return
    const parsed = parseTime24(timeStr)
    if (!parsed) return
    const base = new Date(localDueAt)
    base.setHours(parsed.h, parsed.m, 0, 0)
    setLocalDueAt(base.getTime())
  }

  const readFields = () => ({
    title: titleRef.current?.value.trim() ?? task.title,
    notes: notesRef.current?.value.trim() ?? (task.notes ?? ''),
  })

  const fieldsChanged = (f: { title: string; notes: string }) =>
    f.title !== task.title || f.notes !== (task.notes ?? '')

  /** Returns the write so callers that need to act *after* it lands (the
   *  calendar push reads the task back from the server) can wait on it. */
  const commitFields = (f: { title: string; notes: string }): Promise<unknown> => {
    if (!fieldsChanged(f)) return Promise.resolve()
    return updateTask.mutateAsync({
      id: task.id,
      title: f.title || task.title,
      notes: f.notes || null,
    })
  }

  const commitText = () => {
    // Capture now (refs still live); write next tick so Done/overlay can arm
    // closingRef first and take ownership of the write after unmount.
    const f = readFields()
    setTimeout(() => {
      if (closingRef.current) return
      void commitFields(f).catch(() => {
        toast.error('Could not save the task')
      })
    }, 0)
  }

  /** Focused subtask title edit — only needed when blur is suppressed by close. */
  const captureFocusedSubtask = (): DeferredWrite | null => {
    const el = document.activeElement
    if (!(el instanceof HTMLInputElement)) return null
    const id = el.dataset.subtaskId
    if (!id) return null
    const was = el.dataset.subtaskWas ?? ''
    const next = el.value.trim()
    if (!next || next === was) return null
    return () => updateTask.mutate({ id, title: next })
  }

  const collectPending = (): PendingWrites => ({
    fields: readFields(),
    subtask: captureFocusedSubtask(),
    draft: draftCaptureRef.current?.() ?? null,
  })

  // Pointerdown fires before the browser moves focus to the clicked button, so
  // this is the last turn where document.activeElement can still be an edited
  // subtask input. Capture here; the click handler only closes.
  const armClose = () => {
    closingRef.current = true
    pendingRef.current = collectPending()
  }

  // Suppress-only variant for actions whose field writes are moot (delete).
  const armSuppress = () => {
    closingRef.current = true
  }

  const closeWith = (after?: () => void) => {
    closingRef.current = true
    const p = pendingRef.current ?? collectPending()
    pendingRef.current = null
    // capture due state at close time for deferred commit (optimistic close)
    const dueAtToCommit = localDueAt
    const reminderToCommit = localReminder
    const addToCalToCommit = localAddToCal
    const changed =
      dueAtToCommit !== task.dueAt ||
      reminderToCommit !== task.reminderMinutes ||
      addToCalToCommit !== task.addToCalendar ||
      fieldsChanged(p.fields)
    // A round trip to Google is worth it when the task wants an event, or
    // when it already has one that now needs updating or removing. Title and
    // notes count: they are the event's summary and description.
    const touchesCalendar =
      changed && (addToCalToCommit || task.calendarEventId !== null)
    onClose()
    setTimeout(() => {
      p.subtask?.()
      p.draft?.()

      const patch: {
        dueAt?: number | null
        reminderMinutes?: number | null
        addToCalendar?: boolean
      } = {}
      if (dueAtToCommit !== task.dueAt) patch.dueAt = dueAtToCommit
      if (reminderToCommit !== task.reminderMinutes)
        patch.reminderMinutes = reminderToCommit
      if (addToCalToCommit !== task.addToCalendar)
        patch.addToCalendar = addToCalToCommit

      // Both writes go out together, but the calendar push waits for both to
      // land: it re-reads the task on the server, so starting it early is how
      // a renamed task used to reach Google under its old title.
      const written = Promise.all([
        commitFields(p.fields),
        Object.keys(patch).length > 0
          ? updateTask.mutateAsync({ id: task.id, ...patch })
          : Promise.resolve(),
      ])

      void written
        .then(() => (touchesCalendar ? syncToCalendar(task.id) : null))
        .then((outcome) => {
          if (!outcome) return
          if (outcome.ok) {
            if (!outcome.silent) toast.success(outcome.message)
          } else {
            toast.error(outcome.message, { description: outcome.detail })
          }
        })
        .catch((e: unknown) => {
          toast.error('Could not save the task', {
            description: e instanceof Error ? e.message : String(e),
          })
        })
      after?.()
    }, 0)
  }

  const close = () => {
    closeWith()
  }

  // X / overlay / Escape means discard edits. No field, subtask, draft
  // or deferred due/calendar changes are persisted.
  const cancel = () => {
    closingRef.current = true
    pendingRef.current = null
    // Revert deferred due state so a quick reopen shows persisted values
    setLocalDueAt(task.dueAt ?? null)
    setLocalReminder(task.reminderMinutes ?? 15)
    setLocalAddToCal(!!task.calendarEventId)
    setTimeInput(task.dueAt ? format(new Date(task.dueAt), 'HH:mm') : '09:00')
    // Clear any draft input so typed text does not leak into next open
    const draftEl = document.querySelector<HTMLInputElement>(
      'input[placeholder="Add a subtask"]',
    )
    if (draftEl) draftEl.value = ''
    onClose()
    setTimeout(() => {
      closingRef.current = false
    }, 0)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && cancel()}>
      <DialogContent
        showCloseButton={false}
        className="max-w-md"
        data-proj={project?.color}
      >
        <DialogHeader>
          <DialogTitle className="sr-only">Task details</DialogTitle>
          <span className="os-label flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-proj" />
            {project?.name}
          </span>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Input
            ref={titleRef}
            key={task.id}
            defaultValue={task.title}
            onBlur={commitText}
            onKeyDown={(e) => e.key === 'Enter' && close()}
            className="h-auto border-0 border-b border-border bg-transparent px-2 py-2 text-base font-medium shadow-none focus-visible:ring-0"
            aria-label="Task title"
          />

          <Textarea
            ref={notesRef}
            key={task.id}
            defaultValue={task.notes ?? ''}
            onBlur={commitText}
            placeholder="Notes…"
            rows={4}
            // field-sizing-fixed + no spellcheck: both re-run on every
            // keystroke (intrinsic re-measure / text re-scan) and made typing
            // long notes lag. Fixed height, scrolls inside, drag to enlarge.
            spellCheck={false}
            className="field-sizing-fixed max-h-64 resize-y"
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="os-label">Due</Label>
              <div className="flex items-center gap-1.5">
                <Popover open={dueOpen} onOpenChange={setDueOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        'w-[9.5rem] justify-start gap-2 font-mono text-xs',
                        !localDueAt && 'text-muted-foreground',
                      )}
                    >
                      <CalendarIcon className="size-3.5" />
                      {localDueAt
                        ? format(new Date(localDueAt), 'd MMM yyyy')
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
                      selected={localDueAt ? new Date(localDueAt) : undefined}
                      onSelect={(d) => {
                        setDueOpen(false)
                        if (!d) {
                          setLocalDueAt(null)
                          return
                        }
                        const timeStr = timeInput || '09:00'
                        const parsed = parseTime24(timeStr) ?? { h: 9, m: 0 }
                        const combined = new Date(d)
                        combined.setHours(parsed.h, parsed.m, 0, 0)
                        setLocalDueAt(combined.getTime())
                      }}
                    />
                    <div className="border-t p-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        disabled={!localDueAt}
                        onClick={() => {
                          setDueOpen(false)
                          setLocalDueAt(null)
                        }}
                      >
                        Clear date
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
                <Input
                  value={timeInput}
                  disabled={!localDueAt}
                  onChange={(e) => {
                    // allow typing, keep 24h HH:MM
                    let v = e.target.value.replace(/[^0-9:]/g, '')
                    // auto-insert colon
                    if (v.length === 2 && timeInput.length === 1 && !v.includes(':')) v = v + ':'
                    if (v.length > 5) v = v.slice(0, 5)
                    setTimeInput(v)
                  }}
                  onBlur={() => {
                    const parsed = parseTime24(timeInput)
                    if (!parsed) {
                      // revert to previous valid
                      setTimeInput(localDueAt ? format(new Date(localDueAt), 'HH:mm') : '09:00')
                      return
                    }
                    const formatted = String(parsed.h).padStart(2, '0') + ':' + String(parsed.m).padStart(2, '0')
                    setTimeInput(formatted)
                    applyTimeToLocal(formatted)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                  placeholder="HH:MM"
                  className="h-8 w-[5.5rem] border-input bg-transparent px-2 font-mono text-xs shadow-xs"
                  aria-label="Due time 24h"
                />
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">24h · HH:MM</span>
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

          {CALENDAR_ENABLED ? (
          <div className="flex flex-col gap-2 rounded-md border px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Switch
                  checked={localDueAt ? localAddToCal : false}
                  disabled={!localDueAt || !calendarReady}
                  onCheckedChange={setLocalAddToCal}
                />
                <Label className="text-sm font-medium">Add to calendar</Label>
              </span>
              <span className="text-xs text-muted-foreground">
                {calendarHint}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Reminder</Label>
              <Select
                value={String(localReminder)}
                onValueChange={(v) => setLocalReminder(Number(v))}
              >
              <SelectTrigger size="sm" className="w-[180px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5 minutes before</SelectItem>
                <SelectItem value="15">15 minutes before</SelectItem>
                <SelectItem value="30">30 minutes before</SelectItem>
                <SelectItem value="60">60 minutes before</SelectItem>
              </SelectContent>
            </Select>
            </div>
          </div>
          ) : (
          <ComingSoon
            title="Calendar sync"
            description="Google Calendar integration is on its way."
          />
          )}

          <Subtasks
            parent={task}
            board={board}
            closingRef={closingRef}
            draftCaptureRef={draftCaptureRef}
          />

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
              onPointerDown={armClose}
              onClick={() =>
                closeWith(() => {
                  updateTask.mutate({ id: task.id, archived: !task.archived })
                })
              }
            >
              <Archive className="size-3.5" />
              {task.archived ? 'Unarchive' : 'Archive'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-destructive hover:text-destructive"
              onPointerDown={armSuppress}
              onClick={() => {
                closingRef.current = true
                onClose()
                setTimeout(() => {
                  deleteTask.mutate({ id: task.id })
                }, 0)
              }}
            >
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          </div>
          <Button size="sm" onPointerDown={armClose} onClick={close}>
            Done
          </Button>
        </DialogFooter>
        {/* Last in DOM so Radix autofocus lands on the title input, as before.
            Visually unchanged: absolute top-right. Must keep onPointerDown
            arming here, ahead of click, so X still discards instead of
            committing. */}
        <button
          type="button"
          aria-label="Close"
          onPointerDown={() => {
            closingRef.current = true
          }}
          onClick={cancel}
          className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
        >
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </button>
      </DialogContent>
    </Dialog>
  )
}
