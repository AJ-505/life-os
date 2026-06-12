import { useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  differenceInCalendarDays,
  format,
  isPast,
  isToday,
  isTomorrow,
} from 'date-fns'
import { CalendarRange, Crosshair, Flag } from 'lucide-react'

import { cn } from '#/design-system'
import { Checkbox } from '#/design-system/ui/checkbox'

import { POSITION_GAP } from '../types'
import { boardQueryOptions, useSetTaskFocus, useUpdateTask } from '../queries'
import { activeProjects } from '../board/board-logic'
import { DueChip } from '../board/TaskRow'
import { TaskDetails } from '../board/TaskDetails'

import type { BoardData, Project, Task } from '../types'

type Entry =
  | { kind: 'task'; due: Date; task: Task; project: Project }
  | { kind: 'milestone'; due: Date; project: Project }

const BUCKETS = ['Overdue', 'Today', 'Tomorrow', 'This week', 'Later'] as const
type Bucket = (typeof BUCKETS)[number]

function bucketOf(due: Date): Bucket {
  if (isToday(due)) return 'Today'
  if (isPast(due)) return 'Overdue'
  if (isTomorrow(due)) return 'Tomorrow'
  if (differenceInCalendarDays(due, new Date()) < 7) return 'This week'
  return 'Later'
}

function collectEntries(board: BoardData): Map<Bucket, Array<Entry>> {
  const entries: Array<Entry> = []
  for (const p of activeProjects(board)) {
    if (p.targetDate) {
      entries.push({ kind: 'milestone', due: new Date(p.targetDate), project: p })
    }
    for (const t of p.tasks) {
      if (t.dueAt && !t.archived && !t.done) {
        entries.push({ kind: 'task', due: new Date(t.dueAt), task: t, project: p })
      }
    }
  }
  entries.sort((a, b) => a.due.getTime() - b.due.getTime())
  const grouped = new Map<Bucket, Array<Entry>>()
  for (const e of entries) {
    const b = bucketOf(e.due)
    grouped.set(b, [...(grouped.get(b) ?? []), e])
  }
  return grouped
}

function TaskEntry({
  task,
  project,
  board,
}: {
  task: Task
  project: Project
  board: BoardData
}) {
  const updateTask = useUpdateTask()
  const setFocus = useSetTaskFocus()
  const [open, setOpen] = useState(false)

  return (
    <div
      data-proj={project.color}
      className="group flex items-start gap-2.5 rounded-md border bg-card px-3 py-2 shadow-sm transition-colors hover:border-proj/40"
    >
      <Checkbox
        checked={task.done}
        onCheckedChange={(checked) =>
          updateTask.mutate({ id: task.id, done: checked === true })
        }
        aria-label="Done"
        className="mt-0.5 rounded-full"
      />
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-w-0 flex-1 cursor-pointer text-left"
      >
        <p className="text-sm leading-snug">{task.title}</p>
        <p className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[10px] uppercase tracking-wider text-proj/80">
          <span className="size-1.5 rounded-full bg-proj" />
          {project.name}
        </p>
      </button>
      <DueChip due={task.dueAt!} done={task.done} />
      <button
        type="button"
        aria-label={task.inFocus ? 'Remove from focus' : 'Add to focus'}
        onClick={() =>
          setFocus.mutate({
            id: task.id,
            inFocus: !task.inFocus,
            focusOrder: Date.now() / 1000 + POSITION_GAP,
          })
        }
        className={cn(
          'mt-0.5 shrink-0 cursor-pointer transition-opacity',
          task.inFocus
            ? 'text-signal opacity-100'
            : 'text-muted-foreground opacity-0 hover:text-signal group-hover:opacity-100',
        )}
      >
        <Crosshair className="size-3.5" />
      </button>
      {open ? (
        <TaskDetails task={task} board={board} open={open} onClose={() => setOpen(false)} />
      ) : null}
    </div>
  )
}

export function TimelineView() {
  const { data: board } = useSuspenseQuery(boardQueryOptions)
  const grouped = collectEntries(board)
  const total = [...grouped.values()].reduce((n, l) => n + l.length, 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-baseline gap-3 border-b px-4 py-2.5">
        <h1 className="text-lg font-bold tracking-tight">Timeline</h1>
        <span className="os-label">
          {total} dated item{total === 1 ? '' : 's'} across every project
        </span>
      </div>

      <div className="board-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 pb-24">
          {total === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
              <CalendarRange className="size-6 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Nothing has a date yet. Open any task and give it a due date —
                it shows up here, no separate calendar app needed.
              </p>
            </div>
          ) : (
            BUCKETS.map((bucket) => {
              const entries = grouped.get(bucket)
              if (!entries || entries.length === 0) return null
              return (
                <section key={bucket} className="rise-in">
                  <h2
                    className={cn(
                      'os-label mb-2',
                      bucket === 'Overdue' && '!text-signal',
                    )}
                  >
                    {bucket}
                    <span className="ml-2 opacity-60">{entries.length}</span>
                  </h2>
                  <div className="flex flex-col gap-1.5">
                    {entries.map((e) =>
                      e.kind === 'task' ? (
                        <TaskEntry
                          key={e.task.id}
                          task={e.task}
                          project={e.project}
                          board={board}
                        />
                      ) : (
                        <div
                          key={`m-${e.project.id}`}
                          data-proj={e.project.color}
                          className="flex items-center gap-2.5 rounded-md border border-proj/40 bg-proj/5 px-3 py-2"
                        >
                          <Flag className="size-4 text-proj" />
                          <p className="flex-1 text-sm font-medium">
                            {e.project.name}
                            <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-proj/80">
                              target
                            </span>
                          </p>
                          <span className="font-mono text-[10px] text-proj">
                            {format(e.due, 'd MMM yyyy')}
                          </span>
                        </div>
                      ),
                    )}
                  </div>
                </section>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
