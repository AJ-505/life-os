import { defineConfig } from 'vitest/config'

/**
 * Kept separate from vite.config.ts: the app config loads TanStack Start,
 * Nitro and the React Compiler babel pass, none of which the pure-logic tests
 * need, and all of which make a test run slow enough to stop being useful.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'convex/**/*.test.ts'],
  },
})
