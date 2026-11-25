import { useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { format } from 'date-fns/format'
import { CalendarRange, Crosshair, Flag } from 'lucide-react'

import { cn } from '#/design-system'
import { Checkbox } from '#/design-system/ui/checkbox'

import { buildTaskIndex, activeProjects } from '../board/board-logic'
import { appendFocusOrder } from '../board/placement'
import { DueChip } from '../board/TaskRow'
import { TaskDetails } from '../board/TaskDetails'
import { DUE_BUCKETS, dueBucket } from '../due'
import { boardQueryOptions, useSetTaskFocus, useUpdateTask } from '../queries'

import type { DueBucket } from '../due'
import type { BoardData, Project, Task } from '../types'

type Entry =
  | { kind: 'task'; due: number; task: Task; project: Project }
  | { kind: 'milestone'; due: number; project: Project }

function collectEntries(board: BoardData): Map<DueBucket, Array<Entry>> {
  const entries: Array<Entry> = []
  for (const p of activeProjects(board)) {
    if (p.targetDate) {
      entries.push({ kind: 'milestone', due: p.targetDate, project: p })
    }
    for (const t of p.tasks) {
      if (t.dueAt && !t.archived && !t.done) {
        entries.push({ kind: 'task', due: t.dueAt, task: t, project: p })
      }
    }
  }
  entries.sort((a, b) => a.due - b.due)
  const now = Date.now()
  const grouped = new Map<DueBucket, Array<Entry>>()
  for (const e of entries) {
    const b = dueBucket(e.due, now)
    const bucket = grouped.get(b)
    if (bucket) bucket.push(e)
    else grouped.set(b, [e])
  }
  return grouped
}

function TaskEntry({
  task,
  due,
  project,
  board,
  onOpen,
}: {
  task: Task
  due: number
  project: Project
  board: BoardData
  onOpen: () => void
}) {
  const updateTask = useUpdateTask()
  const setFocus = useSetTaskFocus()

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
        onClick={onOpen}
        className="min-w-0 flex-1 cursor-pointer text-left"
      >
        <p className="text-sm leading-snug">{task.title}</p>
        <p className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[10px] uppercase tracking-wider text-proj/80">
          <span className="size-1.5 rounded-full bg-proj" />
          {project.name}
        </p>
      </button>
      <DueChip due={due} done={task.done} />
      <button
        type="button"
        aria-label={task.inFocus ? 'Remove from focus' : 'Add to focus'}
        onClick={() =>
          setFocus.mutate({
            id: task.id,
            inFocus: !task.inFocus,
            focusOrder: appendFocusOrder(board, task.id),
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
    </div>
  )
}

export function TimelineView() {
  const { data: board } = useSuspenseQuery(boardQueryOptions(null))
  const grouped = collectEntries(board)
  const total = [...grouped.values()].reduce((n, l) => n + l.length, 0)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const openTask = openTaskId
    ? (buildTaskIndex(board).get(openTaskId)?.task ?? null)
    : null

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
            DUE_BUCKETS.map((bucket) => {
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
                          due={e.due}
                          project={e.project}
                          board={board}
                          onOpen={() => setOpenTaskId(e.task.id)}
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
      {openTask ? (
        <TaskDetails
          key={openTask.id}
          task={openTask}
          board={board}
          onClose={() => setOpenTaskId(null)}
        />
      ) : null}
    </div>
  )
}
