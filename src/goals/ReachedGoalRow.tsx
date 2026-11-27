import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns/formatDistanceToNow'
import { RotateCcw, Trash2 } from 'lucide-react'

import { ConfirmDelete } from '#/design-system/confirm-delete'
import { Button } from '#/design-system/ui/button'

import { formatAmount, isPercentGoal } from './goal-display'
import { useDeleteGoal, useReopenGoal } from './queries'

import type { Goal } from './queries'

function measureOf(goal: Goal) {
  if (isPercentGoal(goal)) return '100%'
  return [formatAmount(goal.target), goal.unit].filter(Boolean).join(' ')
}

export function ReachedGoalRow({ goal }: { goal: Goal }) {
  const reopen = useReopenGoal()
  const deleteGoal = useDeleteGoal()
  const [confirming, setConfirming] = useState(false)

  return (
    <div
      data-proj={goal.color}
      className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-sm"
    >
      <span className="size-2.5 shrink-0 rounded-full bg-proj" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{goal.title}</p>
        <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
          {measureOf(goal)}
          {goal.reachedAt
            ? ` · reached ${formatDistanceToNow(goal.reachedAt, { addSuffix: true })}`
            : ''}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5"
        onClick={() => reopen.mutate({ id: goal.id })}
      >
        <RotateCcw className="size-3.5" /> Reopen
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Delete ${goal.title}`}
        className="size-8 text-muted-foreground hover:text-destructive"
        onClick={() => setConfirming(true)}
      >
        <Trash2 className="size-4" />
      </Button>
      <ConfirmDelete
        label={`“${goal.title}”`}
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => deleteGoal.mutate({ id: goal.id })}
      />
    </div>
  )
}
