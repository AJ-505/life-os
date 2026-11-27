import { useState } from 'react'
import { format } from 'date-fns/format'
import { CalendarIcon } from 'lucide-react'

import { cn } from '#/design-system'
import { Button } from '#/design-system/ui/button'
import { Calendar } from '#/design-system/ui/calendar'
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
import { Tabs, TabsList, TabsTrigger } from '#/design-system/ui/tabs'
import { ColorSwatches } from '#/tracker/ColorSwatches'

import {
  MAX_GOAL_TARGET,
  MAX_GOAL_TITLE,
  MAX_GOAL_UNIT,
} from '../../convex/goalModel'
import { isPercentGoal } from './goal-display'

import type { GoalFields } from '../../convex/goalModel'
import type { Goal } from './queries'

type Measure = 'percent' | 'number'

type Draft = {
  title: string
  color: string
  measure: Measure
  target: string
  unit: string
  targetDate: number | null
}

function draftOf(goal: Goal | null, color: string): Draft {
  if (!goal)
    return {
      title: '',
      color,
      measure: 'percent',
      target: '',
      unit: '',
      targetDate: null,
    }
  const percent = isPercentGoal(goal)
  return {
    title: goal.title,
    color: goal.color,
    measure: percent ? 'percent' : 'number',
    target: percent ? '' : String(goal.target),
    unit: goal.unit ?? '',
    targetDate: goal.targetDate,
  }
}

function fieldsOf(draft: Draft): GoalFields | null {
  const title = draft.title.trim()
  if (!title) return null
  if (draft.measure === 'percent')
    return {
      title,
      color: draft.color,
      target: 100,
      unit: null,
      targetDate: draft.targetDate,
    }
  const target = Number(draft.target)
  if (!Number.isFinite(target) || target <= 0 || target > MAX_GOAL_TARGET)
    return null
  return {
    title,
    color: draft.color,
    target,
    unit: draft.unit.trim() || null,
    targetDate: draft.targetDate,
  }
}

function TargetDateField({
  value,
  onChange,
}: {
  value: number | null
  onChange: (value: number | null) => void
}) {
  const [open, setOpen] = useState(false)
  const choose = (next: number | null) => {
    setOpen(false)
    onChange(next)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'w-[10rem] justify-start gap-2 font-mono text-xs',
            !value && 'text-muted-foreground',
          )}
        >
          <CalendarIcon className="size-3.5" />
          {value ? format(new Date(value), 'd MMM yyyy') : 'No date'}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0"
        align="start"
        side="bottom"
        sideOffset={4}
        collisionPadding={12}
      >
        <Calendar
          mode="single"
          selected={value ? new Date(value) : undefined}
          onSelect={(day) => choose(day ? day.getTime() : null)}
        />
        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            disabled={!value}
            onClick={() => choose(null)}
          >
            Clear date
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function GoalDialog({
  goal,
  color,
  open,
  onClose,
  onSave,
}: {
  goal: Goal | null
  color: string
  open: boolean
  onClose: () => void
  onSave: (fields: GoalFields) => void
}) {
  const [draft, setDraft] = useState(() => draftOf(goal, color))
  const goalId = goal?.id ?? null
  const [shownFor, setShownFor] = useState({ open, goalId })
  if (shownFor.open !== open || shownFor.goalId !== goalId) {
    setShownFor({ open, goalId })
    if (open) setDraft(draftOf(goal, color))
  }

  const edit = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })
  const fields = fieldsOf(draft)
  const save = () => {
    if (!fields) return
    onSave(fields)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{goal ? 'Edit goal' : 'New goal'}</DialogTitle>
          <DialogDescription>
            {goal
              ? 'Change what you are aiming for.'
              : 'Name it, then move its slider as you get closer.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="goal-title" className="os-label">
              Goal
            </Label>
            <Input
              id="goal-title"
              autoFocus
              maxLength={MAX_GOAL_TITLE}
              placeholder="Read 24 books"
              value={draft.title}
              onChange={(event) => edit({ title: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="os-label">Measure</Label>
            <Tabs
              value={draft.measure}
              onValueChange={(measure) =>
                edit({ measure: measure === 'number' ? 'number' : 'percent' })
              }
            >
              <TabsList className="h-8">
                <TabsTrigger value="percent" className="px-3 text-xs">
                  Percent
                </TabsTrigger>
                <TabsTrigger value="number" className="px-3 text-xs">
                  A number
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {draft.measure === 'number' ? (
              <div className="flex gap-2">
                <Input
                  aria-label="Target"
                  inputMode="decimal"
                  type="number"
                  min={0}
                  step="any"
                  placeholder="24"
                  className="w-28 font-mono"
                  value={draft.target}
                  onChange={(event) => edit({ target: event.target.value })}
                />
                <Input
                  aria-label="Unit"
                  maxLength={MAX_GOAL_UNIT}
                  placeholder="books"
                  value={draft.unit}
                  onChange={(event) => edit({ unit: event.target.value })}
                />
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="os-label">Colour</Label>
            <ColorSwatches
              value={draft.color}
              onChange={(next) => edit({ color: next })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="os-label">Target date</Label>
            <TargetDateField
              value={draft.targetDate}
              onChange={(targetDate) => edit({ targetDate })}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!fields}>
              {goal ? 'Save' : 'Add goal'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
