import { useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { format } from 'date-fns'
import { Archive, CalendarIcon, Crosshair, Plus, Trash2, X } from 'lucide-react'

import { cn } from '#/design-system'
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
  childrenRef.current = children

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

  draftCaptureRef.current = () => {
    const t = takeDraft()
    if (!t) return null
    return () => commitDraft(t)
  }

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

  const readFields = () => ({
    title: titleRef.current?.value.trim() ?? task.title,
    notes: notesRef.current?.value.trim() ?? (task.notes ?? ''),
  })

  const commitFields = (f: { title: string; notes: string }) => {
    if (f.title !== task.title || f.notes !== (task.notes ?? '')) {
      updateTask.mutate({
        id: task.id,
        title: f.title || task.title,
        notes: f.notes || null,
      })
    }
  }

  const commitText = () => {
    // Capture now (refs still live); write next tick so Done/overlay can arm
    // closingRef first and take ownership of the write after unmount.
    const f = readFields()
    setTimeout(() => {
      if (closingRef.current) return
      commitFields(f)
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
    onClose()
    setTimeout(() => {
      p.subtask?.()
      p.draft?.()
      commitFields(p.fields)
      after?.()
    }, 0)
  }

  const close = () => {
    closeWith()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md" data-proj={project?.color}>
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
              <Popover open={dueOpen} onOpenChange={setDueOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      'w-[9.5rem] justify-start gap-2 font-mono text-xs',
                      !task.dueAt && 'text-muted-foreground',
                    )}
                  >
                    <CalendarIcon className="size-3.5" />
                    {task.dueAt
                      ? format(new Date(task.dueAt), 'd MMM yyyy')
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
                    selected={task.dueAt ? new Date(task.dueAt) : undefined}
                    onSelect={(d) => {
                      setDueOpen(false)
                      updateTask.mutate({
                        id: task.id,
                        dueAt: d ? d.getTime() : null,
                      })
                    }}
                  />
                  <div className="border-t p-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      disabled={!task.dueAt}
                      onClick={() => {
                        setDueOpen(false)
                        updateTask.mutate({ id: task.id, dueAt: null })
                      }}
                    >
                      Clear date
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
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
      </DialogContent>
    </Dialog>
  )
}
