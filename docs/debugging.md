# Debugging LifeOS

Zed reads the debug scenarios in `.zed/debug.json`. Open the debug picker
and choose a scenario whose label starts with `LifeOS:`. Start
`LifeOS: app server` before `LifeOS: browser (Chrome)`.

## Pick a lane

| Lane             | Scenario                                                                     | Use it for                                                                        |
| ---------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Browser          | `LifeOS: browser (Chrome)`                                                   | React components, event handlers, client-side code                                |
| App server       | `LifeOS: app server (Vite SSR + server functions)`                           | Route loaders, the root component during server render, `createServerFn` handlers |
| Convex functions | `LifeOS: Convex function tests (current file)` or `LifeOS: all Convex tests` | Queries, mutations and actions in `convex/`                                       |

## Browser

The browser scenario opens Chrome at `http://localhost:5174`. It does not
start the app. Run `LifeOS: app server` first, or run
`pnpm exec vite dev --port 5174 --strictPort` in a terminal.

Breakpoints in `src/**/*.tsx` work because Vite serves source maps with
each module. A breakpoint on a JSX line can stop on a nearby line that the
compiler kept.

## App server

The app server scenario starts Vite under the debugger on port 5174.
Breakpoints in server-side code run when a page renders on the server.
Load a page to trigger a render, in the browser or with
`curl http://localhost:5174/`. The first request after start is slow, about
20 seconds, while Vite warms its dependency cache.

The scenarios use plain `localhost:5174`, not portless. The browser
scenario needs a fixed URL, and the Clerk development keys in `.env.local`
accept localhost.

There is no dev sign-in in the code. Pages show the sign-in screen until
you sign in with Clerk.

## Convex functions

Convex functions run on Convex's cloud, so the debugger cannot attach to
them. `convex-test` runs the same functions in-process under vitest, and
the debugger can stop inside them.

- `LifeOS: Convex function tests (current file)` runs the test file you
  have open. It also runs a test under `src/`, because vitest picks the
  project from the file path.
- `LifeOS: all Convex tests` runs the whole `convex` project.

A breakpoint in a handler in `convex/*.ts` stops the run when a test calls
that handler. For example, set a breakpoint in the `importBackup` handler
in `convex/backup.ts`, then run the scenario on `convex/duration.test.ts`.

## One user action, end to end

1. Start `LifeOS: app server` if the path touches server code. Start
   `LifeOS: browser (Chrome)`. Set a breakpoint in the click handler.
2. Click the control. The debugger stops in the handler. Step over until
   the Convex mutation call.
3. Stepping into the call stops at the client. The function body runs on
   Convex's cloud, so it is not visible from the browser.
4. To debug the function body, find or write a `convex-test` case that
   calls the same API function. Set a breakpoint in the handler and run
   the Convex test scenario on that file.

Run the task `LifeOS: convex dev (push functions)` after you change code
in `convex/`. The dev deployment then runs your change. Debugging with
convex-test does not need it.

Personal debug scenarios for other runtimes, and the keymap, live outside
this repo in `~/code/devtools/zed-debug/README.md`.
