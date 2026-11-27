import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { format } from 'date-fns/format'
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  CircleCheckBig,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react'

import { cn } from '#/design-system'
import { ConfirmDelete } from '#/design-system/confirm-delete'
import { Button } from '#/design-system/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/design-system/ui/dropdown-menu'

import {
  changesProgress,
  clampProgress,
  expectedShare,
  sliderStep,
  weeklyChange,
} from '../../convex/goalModel'
import {
  changeLabel,
  dueLabel,
  formatAmount,
  headline,
  paceLabel,
} from './goal-display'
import { ProgressSlider } from './ProgressSlider'
import { Sparkline } from './Sparkline'

import type { Goal } from './queries'

type Draft = { value: number; released: boolean }

function useProgressDraft(
  goal: Goal,
  commit: (value: number) => Promise<unknown>,
) {
  const [draft, setDraft] = useState<Draft | null>(null)
  if (draft?.released && draft.value === goal.current) setDraft(null)

  const release = (value: number) => {
    if (!changesProgress(goal, value)) {
      setDraft(null)
      return
    }
    setDraft({ value, released: true })
    commit(value).catch(() => setDraft(null))
  }

  return {
    value: draft?.value ?? goal.current,
    move: (value: number) => setDraft({ value, released: false }),
    release: () => {
      if (draft && !draft.released) release(draft.value)
    },
    set: (value: number) => release(clampProgress(value, goal.target)),
  }
}

function AmountEditor({
  goal,
  value,
  big,
  onSet,
}: {
  goal: Goal
  value: number
  big: string
  onSet: (value: number) => void
}) {
  const [text, setText] = useState<string | null>(null)

  if (text === null)
    return (
      <button
        type="button"
        title="Type an exact value"
        onClick={() => setText(String(value))}
        className="cursor-text rounded-md text-left font-sans text-5xl leading-none font-bold tracking-tighter tabular-nums transition-colors hover:text-proj"
      >
        {big}
      </button>
    )

  const finish = () => {
    const next = Number(text)
    if (text.trim() !== '' && Number.isFinite(next)) onSet(next)
    setText(null)
  }

  return (
    <input
      autoFocus
      aria-label={`Exact progress for ${goal.title}`}
      inputMode="decimal"
      type="number"
      min={0}
      max={goal.target}
      step="any"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish()
        if (event.key === 'Escape') setText(null)
      }}
      className="w-[6ch] rounded-md bg-transparent font-sans text-5xl leading-none font-bold tracking-tighter tabular-nums outline-none ring-2 ring-proj/50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
    />
  )
}

function ReachedCover({ goal }: { goal: Goal }) {
  return (
    <div className="goal-reached pointer-events-none absolute inset-0 z-10 flex flex-col items-start justify-end gap-1 rounded-xl bg-proj p-5 text-white">
      <CircleCheckBig className="mb-auto size-6" />
      <span className="text-4xl font-bold tracking-tighter">Reached</span>
      <span className="font-mono text-[10px] tracking-[0.14em] uppercase opacity-80">
        {goal.title} · moving to Library
      </span>
    </div>
  )
}

function GoalMenu({
  goal,
  onEdit,
  onReach,
  onDelete,
}: {
  goal: Goal
  onEdit: () => void
  onReach: () => void
  onDelete: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`More for ${goal.title}`}
          className="text-muted-foreground"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil /> Edit
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onReach}>
          <CircleCheckBig /> Mark reached
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function GoalCard({
  goal,
  now,
  celebrating,
  onCommit,
  onEdit,
  onDelete,
}: {
  goal: Goal
  now: number
  celebrating: boolean
  onCommit: (value: number) => Promise<unknown>
  onEdit: () => void
  onDelete: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const progress = useProgressDraft(goal, onCommit)
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: goal.id })

  const value = progress.value
  const shown = headline(goal, value)
  const change = weeklyChange(goal, now)
  const pace = paceLabel(goal, value, now)
  const Trend = change < 0 ? ArrowDownRight : ArrowUpRight
  const valueText = shown.of
    ? `${formatAmount(value)} ${shown.of}, ${shown.percent}%`
    : `${shown.percent}%`

  return (
    <article
      ref={setNodeRef}
      data-proj={goal.color}
      aria-label={goal.title}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: transition,
      }}
      className={cn(
        'relative flex flex-col rounded-xl border bg-card p-4 shadow-sm sm:p-5',
        isDragging && 'z-20 opacity-60 shadow-lg',
      )}
    >
      {celebrating ? <ReachedCover goal={goal} /> : null}

      <header className="mb-5 flex items-start gap-2">
        <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-proj" />
        <h2 className="min-w-0 flex-1 text-base leading-snug font-semibold break-words">
          {goal.title}
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Reorder ${goal.title}`}
          className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical />
        </Button>
        <GoalMenu
          goal={goal}
          onEdit={onEdit}
          onReach={() => progress.set(goal.target)}
          onDelete={() => setConfirming(true)}
        />
      </header>

      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <AmountEditor
            goal={goal}
            value={value}
            big={shown.big}
            onSet={progress.set}
          />
          {shown.of ? (
            <span className="truncate text-sm text-muted-foreground">
              {shown.of}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 pb-1 font-mono text-[10px] tracking-[0.1em] uppercase">
          {shown.of ? (
            <span className="text-foreground">{shown.percent}%</span>
          ) : null}
          <span
            className={cn(
              'flex items-center gap-0.5',
              change > 0 ? 'text-proj' : 'text-muted-foreground',
            )}
          >
            {change !== 0 ? <Trend className="size-3" /> : null}
            {changeLabel(goal, change)}
          </span>
        </div>
      </div>

      <div className="mb-3">
        <ProgressSlider
          label={`Progress for ${goal.title}`}
          value={value}
          max={goal.target}
          step={sliderStep(goal.target)}
          valueText={valueText}
          pace={expectedShare(goal, now)}
          onDraft={progress.move}
          onRelease={progress.release}
        />
      </div>

      <div className="mb-2">
        <Sparkline
          history={goal.history}
          current={goal.current}
          target={goal.target}
          now={now}
        />
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
        <span>Since {format(goal.createdAt, 'd MMM')}</span>
        {goal.targetDate !== null ? (
          <span className="flex items-center gap-1.5">
            {pace ? (
              <span className={cn(pace.behind ? 'text-signal' : 'text-proj')}>
                {pace.text}
              </span>
            ) : null}
            <CalendarClock className="size-3" />
            {dueLabel(goal.targetDate, now)}
          </span>
        ) : null}
      </footer>

      <ConfirmDelete
        label={`“${goal.title}”`}
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={onDelete}
      />
    </article>
  )
}
