import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { QueryClient, notifyManager } from '@tanstack/react-query'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { ConvexQueryClient } from '@convex-dev/react-query'

import { routeTree } from './routeTree.gen'

export function getRouter() {
  if (typeof document !== 'undefined') {
    notifyManager.setScheduler(window.requestAnimationFrame)
  }

  const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string
  if (!CONVEX_URL) {
    console.error('missing VITE_CONVEX_URL — run `npx convex dev` to set it')
  }

  const convexQueryClient = new ConvexQueryClient(CONVEX_URL)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
      },
    },
  })
  convexQueryClient.connect(queryClient)

  // The Convex client is handed to the root route, which mounts the auth
  // provider (ConvexProviderWithAuth) *inside* the document body after
  // hydration — see src/auth/AuthGate.tsx. It is NOT a router `Wrap`, because
  // Wrap envelops the whole HTML shell and shoo's browser-only auth adapter
  // would then blank the document (and its stylesheet) during SSR.
  const router = createTanStackRouter({
    routeTree,
    context: { queryClient, convexClient: convexQueryClient.convexClient },
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  })

  setupRouterSsrQueryIntegration({ router, queryClient })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
