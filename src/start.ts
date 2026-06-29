import { clerkMiddleware } from '@clerk/tanstack-react-start/server'
import { createStart } from '@tanstack/react-start'

/**
 * Runs Clerk on every request so the server has the caller's auth state. This
 * is what makes `auth()` work inside server functions (see `fetchClerkAuth` in
 * the root route). It does not protect routes by itself — gating is done in the
 * UI via Convex's <Authenticated> / <Unauthenticated> helpers.
 */
export const startInstance = createStart(() => {
  return {
    requestMiddleware: [clerkMiddleware()],
  }
})
