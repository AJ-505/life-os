import { clerkMiddleware } from '@clerk/tanstack-react-start/server'
import { createCsrfMiddleware, createStart } from '@tanstack/react-start'

// Providing our own start instance replaces TanStack Start's default request
// pipeline, which means its built-in CSRF protection for server functions is no
// longer auto-applied — so we re-add it explicitly. Server functions are
// same-origin RPC endpoints and must be protected from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

/**
 * Runs on every request so the server has the caller's auth state. `clerkMiddleware`
 * is what makes `auth()` work inside server functions (see `fetchClerkAuth` in
 * the root route). It does not protect routes by itself — gating is done in the
 * UI via Convex's <Authenticated> / <Unauthenticated> helpers.
 */
export const startInstance = createStart(() => {
  return {
    requestMiddleware: [csrfMiddleware, clerkMiddleware()],
  }
})
