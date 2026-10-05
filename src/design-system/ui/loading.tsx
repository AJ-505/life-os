import * as React from 'react'

import { cn } from '../utils'

/**
 * Loading states are blurred facsimiles of the page that is coming, not
 * spinners. A spinner tells the user to wait; a blurred copy of the real page
 * tells them what they are waiting for, and it holds the page's exact shape so
 * nothing moves when the data lands.
 *
 * `Bar` is the atom: a soft block standing in for one run of text or one
 * control. `LoadingVeil` softens a whole facsimile and hides it from assistive
 * tech, which announces the wait once rather than reading out a fake page.
 */

/** One placeholder block. Sized by the caller to match the thing it replaces,
 *  so the facsimile is the page's own geometry. */
export function Bar({ className }: { className?: string }) {
  return <div aria-hidden className={cn('rounded-md bg-foreground/10', className)} />
}

/** Softens a facsimile of the real page. Everything inside is decoration: it
 *  cannot be clicked or selected, and assistive tech hears the one `label`
 *  instead of a page of empty text. Each `Bar` hides itself; the caller keeps
 *  any other child decorative so nothing is read out. */
export function LoadingVeil({
  label = 'Loading',
  className,
  children,
}: {
  label?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      role="status"
      aria-busy
      aria-label={label}
      className={cn(
        'pointer-events-none animate-pulse blur-[3px] select-none motion-reduce:animate-none',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** A route-agnostic facsimile for the window before the destination is known:
 *  the root `beforeLoad` runs on every navigation, and until it resolves there
 *  is no page to mirror. A blurred header and content block is honest about
 *  "something is coming" without claiming a shape it cannot know. */
export function PageFacsimile() {
  return (
    // The veil fills the shell's column so the inner `flex-1` can claim height.
    <LoadingVeil label="Loading" className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
          <Bar className="h-4 w-24" />
          <Bar className="h-3.5 w-40" />
        </div>
        <div className="board-scroll min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            <Bar className="h-24 w-full rounded-xl" />
            <Bar className="h-24 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </LoadingVeil>
  )
}
