import { Bar, LoadingVeil } from '#/design-system'

/**
 * A blurred copy of the board, shown while the board query resolves.
 *
 * This is what the router's `defaultPendingComponent` renders, and it is the
 * fallback for the Suspense boundary TanStack Router already draws around the
 * routed content — see `Match.js` `renderPending`. The panel used to blank
 * because that fallback resolved to `null`.
 *
 * It mirrors the real board's geometry on purpose: the same header height, the
 * same `w-[82vw]`/`sm:w-[300px]` columns, the same card stack, and — on the
 * personal board — the same 320px focus rail the canvas sits beside. A
 * facsimile of the wrong shape would move when the data landed, which is the
 * jank it exists to remove. The shapes are approximations of `BoardHeader`,
 * `BoardColumn` and `ProjectCardBody`; keep them roughly in step when those
 * change.
 */

/** One project card: title, progress, then a few task rows. */
function CardFacsimile({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-3">
      <div className="flex items-center gap-2">
        <Bar className="size-2.5 rounded-full" />
        <Bar className="h-3.5 w-28" />
        <Bar className="ml-auto h-3 w-10" />
      </div>
      <Bar className="h-1.5 w-full rounded-full" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-2">
            <Bar className="size-3.5 rounded-full" />
            <Bar className={i % 2 === 0 ? 'h-3 w-4/5' : 'h-3 w-3/5'} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** One column of cards, plus the dashed "Project" button the real column ends
 *  with. Widths match `BoardColumn` exactly. */
function ColumnFacsimile({ cards }: { cards: number[] }) {
  return (
    <div className="flex w-[82vw] shrink-0 flex-col gap-3 rounded-xl p-1.5 sm:w-[300px]">
      {cards.map((rows, i) => (
        <CardFacsimile key={i} rows={rows} />
      ))}
      <div className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed py-2">
        <Bar className="h-3 w-16" />
      </div>
    </div>
  )
}

export function BoardFacsimile({ spaceId }: { spaceId: string | null }) {
  return (
    // The veil fills the shell's column so the inner `flex-1` can claim height.
    <LoadingVeil
      label="Loading board"
      className="flex min-h-0 flex-1 flex-col"
    >
      {/* Row: the canvas column and, on the personal board, the focus rail
          beside it — the same split the real board uses. */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header: matches BoardHeader's border, padding and control row. */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5 sm:px-4">
            <div className="hidden items-center gap-2.5 sm:flex">
              <Bar className="h-4 w-20" />
              <Bar className="hidden h-3.5 w-40 lg:block" />
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              {/* A space board carries the switcher and share chrome; the
                  personal board carries the Done switch and the focus toggle.
                  Mirror the right one so the header width matches what lands. */}
              {spaceId !== null ? (
                <>
                  <Bar className="h-8 w-28 rounded-md" />
                  <Bar className="hidden size-6 rounded-full sm:block" />
                  <Bar className="h-8 w-20 rounded-md" />
                </>
              ) : null}
              <Bar className="h-5 w-9 rounded-full" />
              <Bar className="h-8 w-24 rounded-md" />
              {spaceId === null ? (
                <Bar className="hidden size-8 rounded-md lg:block" />
              ) : null}
            </div>
          </div>

          {/* Canvas: the same snap-scroll container and padding as the real one. */}
          <div className="board-canvas board-scroll min-h-0 flex-1 snap-x snap-mandatory overflow-hidden sm:snap-none">
            <div className="flex min-h-full items-start gap-2 p-3 pb-24 lg:pb-3">
              <ColumnFacsimile cards={[3, 2]} />
              <ColumnFacsimile cards={[4]} />
              <ColumnFacsimile cards={[2, 2]} />
            </div>
          </div>
        </div>

        {/* Focus rail: a personal board opens it by default (320px = `w-80`,
            `lg` and up). Without this the canvas is 320px too wide, so the
            columns shift left when the real rail mounts. */}
        {spaceId === null ? (
          <div className="hidden w-80 shrink-0 border-l bg-sidebar/50 lg:block" />
        ) : null}
      </div>
    </LoadingVeil>
  )
}
