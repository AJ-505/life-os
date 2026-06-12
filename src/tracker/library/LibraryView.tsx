import { useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import {
  Archive,
  ArchiveRestore,
  CircleCheckBig,
  RotateCcw,
  Trash2,
  Trophy,
} from 'lucide-react'

import { Badge } from '#/design-system/ui/badge'
import { Button } from '#/design-system/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/design-system/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/design-system/ui/tabs'

import {
  boardQueryOptions,
  useDeleteProject,
  useDeleteTask,
  useSetProjectStatus,
  useUpdateTask,
} from '../queries'

import type { ProjectWithTasks, Task } from '../types'

function ConfirmDelete({
  label,
  open,
  onClose,
  onConfirm,
}: {
  label: string
  open: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete {label}?</DialogTitle>
          <DialogDescription>This is permanent.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProjectRow({
  project,
  variant,
}: {
  project: ProjectWithTasks
  variant: 'shelf' | 'done'
}) {
  const setStatus = useSetProjectStatus()
  const deleteProject = useDeleteProject()
  const [confirming, setConfirming] = useState(false)

  const doneCount = project.tasks.filter((t) => t.done).length
  const when =
    variant === 'shelf' ? project.shelvedAt : project.finishedAt

  return (
    <div
      data-proj={project.color}
      className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-sm"
    >
      <span className="size-2.5 shrink-0 rounded-full bg-proj" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{project.name}</p>
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {doneCount}/{project.tasks.length} tasks
          {when
            ? ` · ${variant === 'shelf' ? 'shelved' : 'finished'} ${formatDistanceToNow(new Date(when), { addSuffix: true })}`
            : ''}
        </p>
      </div>
      {variant === 'shelf' ? (
        <>
          <Button
            variant="secondary"
            size="sm"
            className="gap-1.5"
            onClick={() => setStatus.mutate({ id: project.id, status: 'active' })}
          >
            <RotateCcw className="size-3.5" /> Restore
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => setStatus.mutate({ id: project.id, status: 'done' })}
          >
            <CircleCheckBig className="size-3.5" /> Finish
          </Button>
        </>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() => setStatus.mutate({ id: project.id, status: 'active' })}
        >
          <RotateCcw className="size-3.5" /> Reopen
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        aria-label="Delete project"
        className="size-8 text-muted-foreground hover:text-destructive"
        onClick={() => setConfirming(true)}
      >
        <Trash2 className="size-4" />
      </Button>
      <ConfirmDelete
        label={`“${project.name}”`}
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => deleteProject.mutate({ id: project.id })}
      />
    </div>
  )
}

function ArchivedTaskRow({
  task,
  project,
}: {
  task: Task
  project: ProjectWithTasks
}) {
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const [confirming, setConfirming] = useState(false)

  return (
    <div
      data-proj={project.color}
      className="flex items-center gap-3 rounded-md border bg-card px-3 py-2"
    >
      <span className="size-1.5 shrink-0 rounded-full bg-proj" />
      <p className="min-w-0 flex-1 truncate text-sm">{task.title}</p>
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {project.name}
      </span>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Restore task"
        className="size-7 text-muted-foreground"
        onClick={() => updateTask.mutate({ id: task.id, archived: false })}
      >
        <ArchiveRestore className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Delete task"
        className="size-7 text-muted-foreground hover:text-destructive"
        onClick={() => setConfirming(true)}
      >
        <Trash2 className="size-3.5" />
      </Button>
      <ConfirmDelete
        label="this task"
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => deleteTask.mutate({ id: task.id })}
      />
    </div>
  )
}

function EmptyState({ icon: Icon, text }: { icon: typeof Archive; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
      <Icon className="size-6 text-muted-foreground/50" />
      <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
    </div>
  )
}

export function LibraryView() {
  const { data: board } = useSuspenseQuery(boardQueryOptions)

  const shelved = board
    .filter((p) => p.status === 'shelved')
    .sort(
      (a, b) =>
        new Date(b.shelvedAt ?? 0).getTime() -
        new Date(a.shelvedAt ?? 0).getTime(),
    )
  const finished = board
    .filter((p) => p.status === 'done')
    .sort(
      (a, b) =>
        new Date(b.finishedAt ?? 0).getTime() -
        new Date(a.finishedAt ?? 0).getTime(),
    )
  const completedTasks = board
    .flatMap((p) => p.tasks.map((t) => ({ task: t, project: p })))
    .filter(({ task }) => task.done && !task.archived)
    .sort(
      (a, b) =>
        new Date(b.task.doneAt ?? 0).getTime() -
        new Date(a.task.doneAt ?? 0).getTime(),
    )
  const archivedTasks = board
    .flatMap((p) => p.tasks.map((t) => ({ task: t, project: p })))
    .filter(({ task }) => task.archived)

  // group completed tasks by month for a little "trophy room" feel
  const byMonth = new Map<string, typeof completedTasks>()
  for (const item of completedTasks) {
    const key = item.task.doneAt
      ? format(new Date(item.task.doneAt), 'MMMM yyyy')
      : 'Sometime'
    byMonth.set(key, [...(byMonth.get(key) ?? []), item])
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-baseline gap-3 border-b px-4 py-2.5">
        <h1 className="text-lg font-bold tracking-tight">Library</h1>
        <span className="os-label">
          out of sight, not out of reach
        </span>
      </div>

      <div className="board-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl p-4 pb-24">
          <Tabs defaultValue="shelf">
            <TabsList className="mb-4">
              <TabsTrigger value="shelf" className="gap-1.5">
                <Archive className="size-3.5" /> Shelf
                {shelved.length > 0 ? (
                  <Badge variant="secondary">{shelved.length}</Badge>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="done" className="gap-1.5">
                <Trophy className="size-3.5" /> Accomplished
              </TabsTrigger>
              <TabsTrigger value="archive" className="gap-1.5">
                <ArchiveRestore className="size-3.5" /> Archived tasks
              </TabsTrigger>
            </TabsList>

            <TabsContent value="shelf" className="flex flex-col gap-2">
              {shelved.length === 0 ? (
                <EmptyState
                  icon={Archive}
                  text="Nothing on the shelf. Shelving a project takes it off your board — and out of your head — until you want it back."
                />
              ) : (
                shelved.map((p) => (
                  <ProjectRow key={p.id} project={p} variant="shelf" />
                ))
              )}
            </TabsContent>

            <TabsContent value="done" className="flex flex-col gap-6">
              <div>
                <h2 className="os-label mb-2">Finished projects</h2>
                {finished.length === 0 ? (
                  <EmptyState
                    icon={Trophy}
                    text="No finished projects yet. They'll line up here when you call them done."
                  />
                ) : (
                  <div className="flex flex-col gap-2">
                    {finished.map((p) => (
                      <ProjectRow key={p.id} project={p} variant="done" />
                    ))}
                  </div>
                )}
              </div>
              {completedTasks.length > 0 ? (
                <div>
                  <h2 className="os-label mb-2">
                    Completed tasks · {completedTasks.length}
                  </h2>
                  <div className="flex flex-col gap-4">
                    {[...byMonth.entries()].map(([month, items]) => (
                      <section key={month}>
                        <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
                          {month}
                        </h3>
                        <div className="flex flex-col gap-1">
                          {items.map(({ task, project }) => (
                            <div
                              key={task.id}
                              data-proj={project.color}
                              className="flex items-center gap-2.5 rounded-md px-2 py-1"
                            >
                              <CircleCheckBig className="size-3.5 shrink-0 text-proj" />
                              <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                                {task.title}
                              </p>
                              <span className="font-mono text-[10px] text-muted-foreground/70">
                                {task.doneAt
                                  ? format(new Date(task.doneAt), 'd MMM')
                                  : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>
              ) : null}
            </TabsContent>

            <TabsContent value="archive" className="flex flex-col gap-1.5">
              {archivedTasks.length === 0 ? (
                <EmptyState
                  icon={ArchiveRestore}
                  text="No archived tasks. Archive hides a task from its project without losing it."
                />
              ) : (
                archivedTasks.map(({ task, project }) => (
                  <ArchivedTaskRow key={task.id} task={task} project={project} />
                ))
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
