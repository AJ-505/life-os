import { Clock } from 'lucide-react'

import { cn } from './utils'

/**
 * Placeholder for gated WIP features (see `#/feature-flags`). Renders where
 * the feature UI will live, so hidden work never looks broken or half built.
 */
export function ComingSoon({
  title,
  description,
  className,
}: {
  title: string
  description?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center',
        className,
      )}
    >
      <Clock className="size-5 text-muted-foreground/60" />
      <p className="os-label">Coming soon</p>
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="max-w-xs text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  )
}
