import { useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { Goal as GoalIcon, Plus, Trophy } from 'lucide-react'
import { toast } from 'sonner'

import { useNow } from '#/design-system'
import { Button } from '#/design-system/ui/button'
import { freshColor, newId } from '#/tracker/types'

import { POSITION_GAP, positionAt } from '#/tracker/board/placement'
import { GoalCard } from './GoalCard'
import { GoalDialog } from './GoalDialog'
import {
  goalsQueryOptions,
  useCreateGoal,
  useDeleteGoal,
  useMoveGoal,
  useReopenGoal,
  useSetGoalProgress,
  useUpdateGoal,
} from './queries'

import type { DragEndEvent } from '@dnd-kit/core'
import type { GoalFields } from '../../convex/goalModel'
import type { Goal } from './queries'

const REACHED_COVER_MS = 1700
const UNDO_TOAST_MS = 8000

const mouseSensorOptions = { activationConstraint: { distance: 4 } }
const touchSensorOptions = {
  activationConstraint: { delay: 120, tolerance: 6 },
}
const keyboardSensorOptions = {
  coordinateGetter: sortableKeyboardCoordinates,
}

type DialogState = { open: boolean; goalId: string | null }

function useCelebrations() {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set())
  const stop = (id: string) =>
    setIds((current) => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
  const start = (id: string) => {
    setIds((current) => new Set(current).add(id))
    window.setTimeout(() => stop(id), REACHED_COVER_MS)
  }
  return { ids, start, stop }
}

function EmptyGoals({
  reachedCount,
  onAdd,
}: {
  reachedCount: number
  onAdd: () => void
}) {
  const allReached = reachedCount > 0
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-14 text-center">
      <GoalIcon className="mb-3 size-7 text-muted-foreground/60" />
      <p className="mb-1 text-base font-semibold">
        {allReached ? 'Every goal reached' : 'No goals yet'}
      </p>
      <p className="mb-5 max-w-xs text-sm text-muted-foreground">
        {allReached
          ? 'Add the next thing you are working toward.'
          : 'Add something you are working toward, then move its slider as you get closer.'}
      </p>
      <Button onClick={onAdd} className="gap-1.5">
        <Plus className="size-4" /> New goal
      </Button>
    </div>
  )
}

export function GoalsView() {
  const { data: goals } = useSuspenseQuery(goalsQueryOptions)
  const now = useNow()
  const celebrations = useCelebrations()
  const [dialog, setDialog] = useState<DialogState>({
    open: false,
    goalId: null,
  })
  const createGoal = useCreateGoal()
  const updateGoal = useUpdateGoal()
  const setProgress = useSetGoalProgress()
  const reopenGoal = useReopenGoal()
  const moveGoal = useMoveGoal()
  const deleteGoal = useDeleteGoal()
  const sensors = useSensors(
    useSensor(MouseSensor, mouseSensorOptions),
    useSensor(TouchSensor, touchSensorOptions),
    useSensor(KeyboardSensor, keyboardSensorOptions),
  )

  const active = goals.filter(
    (goal) => goal.reachedAt === null || celebrations.ids.has(goal.id),
  )
  const reachedCount = goals.filter(
    (goal) => goal.reachedAt !== null && !celebrations.ids.has(goal.id),
  ).length
  const nextColor = freshColor(active.map((goal) => goal.color))
  const editing = goals.find((goal) => goal.id === dialog.goalId) ?? null
  const openDialog = (goalId: string | null) =>
    setDialog({ open: true, goalId })

  const commit = (goal: Goal) => (value: number) => {
    const previous = goal.current
    const reaches = value >= goal.target && goal.reachedAt === null
    if (reaches) {
      celebrations.start(goal.id)
      toast.success(`“${goal.title}” reached`, {
        description: 'It is now in Library, under Accomplished.',
        duration: UNDO_TOAST_MS,
        action: {
          label: 'Undo',
          onClick: () => {
            celebrations.stop(goal.id)
            if (previous < goal.target)
              setProgress.mutate({ id: goal.id, value: previous })
            else reopenGoal.mutate({ id: goal.id })
          },
        },
      })
    }
    return setProgress.mutateAsync({ id: goal.id, value })
  }

  const save = (fields: GoalFields) => {
    if (editing) {
      updateGoal.mutate({ id: editing.id, ...fields })
      return
    }
    const last = Math.max(0, ...goals.map((g) => g.position))
    createGoal.mutate({ id: newId(), position: last + POSITION_GAP, ...fields })
  }

  const onDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    if (!over || dragged.id === over.id) return
    const from = active.findIndex((goal) => goal.id === dragged.id)
    const to = active.findIndex((goal) => goal.id === over.id)
    if (from < 0 || to < 0) return
    const others = active.filter((goal) => goal.id !== dragged.id)
    moveGoal.mutate({
      id: active[from].id,
      position: positionAt(
        others.map((goal) => goal.position),
        to,
      ),
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
        <h1 className="text-lg font-bold tracking-tight">Goals</h1>
        <span className="os-label hidden sm:inline">
          how close you are getting
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {reachedCount > 0 ? (
            <Button variant="ghost" size="sm" className="h-8 gap-1.5" asChild>
              <Link
                to="/library"
                search={{ tab: 'done' }}
                className="no-underline"
              >
                <Trophy className="size-3.5" />
                {reachedCount} reached
              </Link>
            </Button>
          ) : null}
          <Button
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => openDialog(null)}
          >
            <Plus className="size-3.5" /> New goal
          </Button>
        </div>
      </div>

      <div className="board-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl p-4 pb-24">
          {active.length === 0 ? (
            <EmptyGoals
              reachedCount={reachedCount}
              onAdd={() => openDialog(null)}
            />
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={active.map((goal) => goal.id)}
                strategy={rectSortingStrategy}
              >
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {active.map((goal) => (
                    <GoalCard
                      key={goal.id}
                      goal={goal}
                      now={now}
                      celebrating={celebrations.ids.has(goal.id)}
                      onCommit={commit(goal)}
                      onEdit={() => openDialog(goal.id)}
                      onDelete={() => deleteGoal.mutate({ id: goal.id })}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>

      <GoalDialog
        goal={editing}
        color={nextColor}
        open={dialog.open}
        onClose={() => setDialog({ ...dialog, open: false })}
        onSave={save}
      />
    </div>
  )
}
