import 'zod/compile'
import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { QueryClient, notifyManager } from '@tanstack/react-query'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { ConvexQueryClient } from '@convex-dev/react-query'
import { ConvexProvider } from 'convex/react'

import { routeTree } from './routeTree.gen'
import { PageFacsimile } from './design-system'

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

  // The root route mounts ClerkProvider → ConvexProviderWithClerk (which wires
  // Clerk's token into Convex). The `Wrap` ConvexProvider here makes the same
  // Convex client available at the router level (loaders, pending/error
  // components) before that component renders; both share the one client, so
  // there's a single WebSocket and the auth set by ConvexProviderWithClerk
  // applies everywhere. `convexQueryClient` is threaded through context so the
  // root `beforeLoad` can set the Clerk token on the SSR HTTP client.
  const router = createTanStackRouter({
    routeTree,
    context: {
      queryClient,
      convexClient: convexQueryClient.convexClient,
      convexQueryClient,
    },
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    // TanStack Router already draws a Suspense boundary around the routed
    // content (`Match.js` `renderPending`); it resolved to `null` because
    // neither pending component was set, which is why the panel blanked on
    // navigation. This fills it with a blurred page instead of a spinner.
    //
    // 1000ms (the framework default) would hide the affordance in the common
    // fast case, which is backwards; 150 shows it, and the 300ms floor stops a
    // fast navigation from strobing it for one frame.
    defaultPendingComponent: PageFacsimile,
    defaultPendingMs: 150,
    defaultPendingMinMs: 300,
    Wrap: ({ children }) => (
      <ConvexProvider client={convexQueryClient.convexClient}>
        {children}
      </ConvexProvider>
    ),
  })

  setupRouterSsrQueryIntegration({ router, queryClient })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
