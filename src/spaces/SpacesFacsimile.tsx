import { Bar, LoadingVeil } from '#/design-system'

/**
 * A blurred copy of the spaces grid, shown while the spaces query resolves.
 *
 * Before this, a pending query fell through `{ data: spaces = [] }` to the
 * "No spaces yet" empty state — a confident claim about a list nobody had read
 * yet. This mirrors the real cards instead, in the same `sm:grid-cols-2` grid
 * at the same content height, so the grid does not move when the data lands.
 *
 * Two cards: one row at the two-column breakpoint, two rows on a phone. Both
 * are plausible for a small account, and it keeps the page short for someone
 * who turns out to have no spaces at all.
 */

function CardFacsimile() {
  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card py-6">
      <div className="flex flex-col gap-2 px-6">
        <div className="flex items-center gap-2">
          <Bar className="size-4 rounded-full" />
          <Bar className="h-4 w-28" />
          <Bar className="ml-auto h-4 w-12 rounded-full" />
        </div>
        <Bar className="h-4 w-20 rounded-full" />
      </div>
      <div className="flex flex-col gap-2 px-6">
        <div className="flex gap-1.5">
          <Bar className="h-8 flex-1 rounded-md" />
          <Bar className="h-8 w-16 rounded-md" />
        </div>
        <Bar className="h-8 w-full rounded-md" />
        <div className="flex items-center gap-1.5">
          <Bar className="h-3 w-20" />
          <Bar className="ml-auto h-3 w-14" />
        </div>
      </div>
    </div>
  )
}

export function SpacesFacsimile() {
  return (
    <LoadingVeil label="Loading spaces">
      <div className="grid gap-3 sm:grid-cols-2">
        <CardFacsimile />
        <CardFacsimile />
      </div>
    </LoadingVeil>
  )
}
