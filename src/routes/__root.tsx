import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouterState,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { createServerFn } from '@tanstack/react-start'
import { ClerkProvider, useAuth } from '@clerk/tanstack-react-start'
import { auth } from '@clerk/tanstack-react-start/server'
import { ConvexProviderWithClerk } from 'convex/react-clerk'
import { Toaster } from 'sonner'

import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'

import { THEME_INIT_SCRIPT, ThemeProvider } from '#/design-system'
import { AppShell } from '#/shell'
import { AuthGate } from '#/auth'
import { linksFor, metaFor, seoForRouteId } from '#/seo'

import appCss from '../styles.css?url'

import type { QueryClient } from '@tanstack/react-query'
import type { ConvexQueryClient } from '@convex-dev/react-query'
import type { ConvexReactClient } from 'convex/react'

interface MyRouterContext {
  queryClient: QueryClient
  convexClient: ConvexReactClient
  convexQueryClient: ConvexQueryClient
}

/** Reads the caller's Clerk session token on the server. Returns null when
 *  signed out. `getToken()` (no template) yields a token with `aud: "convex"`
 *  thanks to Clerk's native Convex integration. */
const fetchClerkAuth = createServerFn({ method: 'GET' }).handler(async () => {
  const { userId, getToken } = await auth()
  const token = await getToken()
  return { userId, token }
})

/** The only two fields the head builder needs from a match. Naming them keeps
 *  `head` out of the route's generic inference — inferring `matches` inline
 *  collapses `beforeLoad`'s expected return type to `never`.
 *
 *  `pathname`, not `fullPath`: `fullPath` is the route *pattern*
 *  (`/join/$inviteCode`), which would put a literal `$inviteCode` into every
 *  shared link's `og:url` and canonical. */
type HeadMatch = { routeId: string; pathname: string }

function buildHead(matches: HeadMatch[]) {
  const deepest = matches[matches.length - 1]
  const pathname = deepest?.pathname ?? '/'
  const page = seoForRouteId(deepest?.routeId ?? '/')
  return {
    meta: [
      { charSet: 'utf-8' as const },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      // Read by crawlers, not by the app: this is what decides how a shared
      // link looks in WhatsApp, Slack and iMessage. No user data reaches it.
      ...metaFor(page, pathname),
    ],
    links: [{ rel: 'stylesheet', href: appCss }, ...linksFor(pathname)],
    scripts: [{ children: THEME_INIT_SCRIPT }],
  }
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  // One builder for the whole document head, driven by the deepest match. The
  // alternative — letting each route add its own og tags — risks two
  // `og:title` elements on one page, and a crawler picks either.
  head: ({ matches }: { matches: HeadMatch[] }) => buildHead(matches),
  beforeLoad: async (ctx) => {
    const { userId, token } = await fetchClerkAuth()
    // serverHttpClient only exists during SSR — give it the Clerk token so
    // loader-driven Convex queries run authenticated on the first render.
    if (token) {
      ctx.context.convexQueryClient.serverHttpClient?.setAuth(token)
    }
    return { userId, token }
  },
  shellComponent: RootDocument,
  component: RootComponent,
})

/** The entire app lives behind a signed-in identity. ClerkProvider →
 *  ConvexProviderWithClerk keep a Convex-validated Clerk token flowing; AuthGate
 *  then renders the board only when authenticated — no per-route guards. */
function RootComponent() {
  const { convexClient } = Route.useRouteContext()
  // The OAuth callback must render OUTSIDE AuthGate: during the handshake the
  // user isn't authenticated yet, so the gate would show the login screen and
  // the callback component would never mount (sign-in would deadlock).
  const isSsoCallback = useRouterState({
    select: (s) => s.location.pathname === '/sso-callback',
  })
  return (
    <ClerkProvider>
      <ConvexProviderWithClerk client={convexClient} useAuth={useAuth}>
        {isSsoCallback ? (
          <Outlet />
        ) : (
          <AuthGate>
            <AppShell>
              <Outlet />
            </AppShell>
          </AuthGate>
        )}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
        <Toaster position="bottom-center" closeButton richColors />
        <TanStackDevtools
          config={{ position: 'bottom-right' }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
            TanStackQueryDevtools,
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
