# UI guidelines

Rules for anything that moves, floats, or has to work on a phone. Each one
comes from a real bug in this app. Read this before you touch popovers,
selects, dialogs, drag and drop, view switches, or a mobile layout.

## Floating UI (Radix popover, select, dropdown, tooltip)

**Never remove a popper's anchor while its content can still animate out.**
Radix positions the content against its anchor on every frame of the exit
animation. If the anchor unmounts in the same render that closes the content,
the content has nothing to measure and jumps to the viewport origin. The user
sees a faint copy fly to the top-left corner. This happened with the calendar
quick-add popover, whose anchor is the dashed draft block.

Pick one:

- Close without an exit animation: `data-[state=closed]:animate-none` on the
  content.
- Keep the anchor mounted (invisible is fine) until the content is gone.

**Item-aligned selects re-align when the value changes.** Radix moves the list
so the chosen option sits over the trigger. Any exit fade keeps the list
visible during that move, so it visibly jumps. `SelectContent` in
`src/design-system/ui/select.tsx` therefore closes with no fade. Do not add
one back.

**Content that can be wider than a phone needs room on the cross axis.** Radix
only shifts along the alignment axis. A `side="right"` popover on a 390 px
screen goes off the left edge. On narrow screens open it `side="bottom"`,
pass `collisionPadding`, and cap the width with
`w-[min(18rem,calc(100vw-1.5rem))]`.

## Prove motion with frames, not screenshots

A screenshot cannot show a 90 ms flicker. Sample the element on every
animation frame while you perform the action, then read the log:

```js
window.__samples = []
const t0 = performance.now()
const tick = () => {
  document.querySelectorAll('[data-slot=popover-content]').forEach((el) => {
    const r = el.getBoundingClientRect()
    window.__samples.push([
      Math.round(performance.now() - t0),
      Math.round(r.left),
      Math.round(r.top),
      getComputedStyle(el).opacity,
      el.dataset.state,
    ])
  })
  if (window.__probe) requestAnimationFrame(tick)
}
window.__probe = true
requestAnimationFrame(tick)
```

A visible frame (opacity above 0) at a position the user did not ask for is a
flicker. Fix it, then run the probe again and show both logs in the PR.

## Instant interactions

- Optimistic first, then immediate feedback (see AGENTS.md).
- Do not put network work on client navigation. The root `beforeLoad` once
  called a server function on every navigation, which made every view switch
  and sidebar link wait about 400 ms.
- Views the user toggles between stay mounted. Hide the inactive one with
  `hidden` and mount a heavy one when the browser is idle, as `BoardView` does
  with the calendar.

## Mobile

- Test every UI change at 390 x 844 as well as desktop.
- No sideways scrolling in a main view. The calendar shows three days on a
  phone instead of a week that scrolls.
- Touch targets need their own gesture rules. Long press starts a drag
  (dnd-kit `TouchSensor`), a quick horizontal swipe changes days, and a
  vertical swipe scrolls.
