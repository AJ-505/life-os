import { Check } from 'lucide-react'

import { cn } from '#/design-system'

import { PROJECT_COLORS } from './types'

export function ColorSwatches({
  value,
  onChange,
}: {
  value: string
  onChange: (c: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {PROJECT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          data-proj={c}
          aria-label={c}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          className={cn(
            'flex size-7 cursor-pointer items-center justify-center rounded-full bg-proj transition-transform hover:scale-110',
            value === c && 'ring-2 ring-ring ring-offset-2 ring-offset-card',
          )}
        >
          {value === c ? <Check className="size-3.5 text-white" /> : null}
        </button>
      ))}
    </div>
  )
}
