import { defineConfig } from 'vitest/config'

/**
 * Two projects, because the two halves need different runtimes.
 *
 * The app tests are pure logic under node. The Convex tests load real function
 * modules through `convex-test`, which needs the edge runtime that Convex
 * itself uses (see `convex/_generated/ai/guidelines.md`). Keeping vite.config
 * out of this is deliberate: it loads TanStack Start, Nitro and the React
 * Compiler pass, none of which the tests need and all of which make a run slow
 * enough to stop being useful.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'app',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'convex',
          environment: 'edge-runtime',
          include: ['convex/**/*.test.ts'],
          setupFiles: ['./convex/test.setup.ts'],
          // The default is 5s per test. A `convex-test` run loads every function
          // module and compiles the schema on the first call in a file, so the
          // first test in each file pays that cost alone. Under 5s it passed
          // or failed on how busy the machine was, which is not a signal.
          testTimeout: 30_000,
        },
      },
    ],
  },
})
