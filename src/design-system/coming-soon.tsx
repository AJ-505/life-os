import { Clock } from 'lucide-react'

import { cn } from './utils'

/**
 * The dashed placeholder that stands where gated UI will live, so hidden work
 * never looks broken or half built.
 *
 * `status` overrides the "Coming soon" label. A feature that exists but is not
 * available in this context says so with a status instead, because telling
 * someone to wait for something that already shipped is a lie the UI tells
 * twice.
 */
export function ComingSoon({
  status = 'Coming soon',
  title,
  description,
  className,
}: {
  status?: string
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
      <p className="os-label">{status}</p>
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="max-w-xs text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  )
}
