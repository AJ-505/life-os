import { cn } from '#/design-system'

const CELLS = 40

export function ProgressSlider({
  label,
  value,
  max,
  step,
  valueText,
  pace,
  onDraft,
  onRelease,
}: {
  label: string
  value: number
  max: number
  step: number
  valueText: string
  pace: number | null
  onDraft: (value: number) => void
  onRelease: () => void
}) {
  const share = Math.max(0, Math.min(1, value / max))
  const filled = Math.round(share * CELLS)

  return (
    <div className="relative h-11 rounded-md has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/2 flex h-6 -translate-y-1/2 items-center gap-[3px]"
      >
        {Array.from({ length: CELLS }, (_, cell) => (
          <span
            key={cell}
            className={cn(
              'h-4 flex-1 rounded-[2px] transition-[height,background-color] duration-150',
              cell < filled ? 'bg-proj' : 'bg-foreground/10',
              cell === filled - 1 && 'h-6',
            )}
          />
        ))}
      </div>
      {pace !== null ? (
        <span
          aria-hidden
          title="Where you would be at an even pace"
          className="pointer-events-none absolute inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground/70"
          style={{ left: `${pace * 100}%` }}
        />
      ) : null}
      <input
        type="range"
        aria-label={label}
        aria-valuetext={valueText}
        min={0}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onDraft(Number(event.target.value))}
        onPointerUp={onRelease}
        onKeyUp={onRelease}
        onBlur={onRelease}
        className="goal-range absolute inset-0 size-full cursor-pointer opacity-0"
      />
    </div>
  )
}
