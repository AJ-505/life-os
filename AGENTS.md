<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Artefacts

Never write reports, debriefs, plans, inquiries, or proofs into this repo.
They go in `~/code/aisandbox/life-os/` (`reports/`, `debriefs/`, `plans/`,
`inquiries/`, `proofs/`). Artefacts are grouped by project at the aisandbox
root, never inside the project's own repository.

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

Bad pattern:

```ts
const raw = localStorage.getItem('lifeos-local-spaces')
return raw ? (JSON.parse(raw) as Array<LocalSpace>) : []
```

Good pattern:

```ts
// entry point, once
import 'zod/compile'

// next to the code that reads the data
import * as z from 'zod'

const localSpaces = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    inviteCode: z.string(),
    createdAt: z.number(),
  }),
)

const parsed = localSpaces.safeParse(JSON.parse(raw ?? '[]'))
return parsed.success ? parsed.data : []
```
