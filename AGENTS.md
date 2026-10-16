<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## How to build UIs
Always prioritise optimistic updates, and then immediate feedback. In that order. If you can make an action feel instant while the query runs in the background, do it. If you cannot, ensure that the user notices something when they click or take an action.

Before you change popovers, selects, dialogs, drag and drop, view switches,
or any mobile layout, read [docs/ui-guidelines.md](docs/ui-guidelines.md). It
lists the flicker and layout bugs this app has already had, and how to prove
a fix frame by frame.

When you verify any change, always test the mobile view (390 x 844) and its touch UX as well as desktop.

## Spacing

Bottom margins only, never top margins. Space between a block and what
follows it belongs on the first block (`mb-*`), not the next one.

## No memoisation

Never hand-write `memo`, `useMemo`, or `useCallback`. The Rust React
Compiler (oxc, enabled in `vite.config.ts`) memoizes components and hooks
at build time. Tooling beats hand memoization because it sees every
dependency and never goes stale: hand-written wrappers rot on the next
edit, miss a dep and ship a stale UI, or wrap things that never needed it.
If the compiler bails on a component, fix the bailout pattern, do not add
manual memo back. Manual memo is a last resort, only when no change to the
code can get the compiler to memoize it. A slowdown after removing memo
means measure first: the cause is usually an extra render or a bailout
elsewhere, not the missing wrapper.

## Validation

Never check objects by hand. No `as` casts on parsed JSON, no
`typeof x ===` chains to guess a shape. Declare a zod schema and parse.
One `import 'zod/compile'` at the app entry auto-compiles every schema on
first parse, so no per-schema compile calls.

This is not the Zod you know. Check the documentation at https://zod.dev/blog/zod-4-5

