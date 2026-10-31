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
import { ClerkProvider } from '@clerk/tanstack-react-start'
import { auth } from '@clerk/tanstack-react-start/server'
import { ConvexProviderWithClerk } from 'convex/react-clerk'
import { Toaster } from 'sonner'

import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'

import { THEME_INIT_SCRIPT, ThemeProvider } from '#/design-system'
import { AppShell } from '#/shell'
import { AuthGate, useAppAuth } from '#/auth'
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

const fetchClerkAuth = createServerFn({ method: 'GET' }).handler(async () => {
  const { userId, getToken } = await auth()
  const token = await getToken()
  return { userId, token }
})

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
      ...metaFor(page, pathname),
    ],
    links: [{ rel: 'stylesheet', href: appCss }, ...linksFor(pathname)],
    scripts: [{ children: THEME_INIT_SCRIPT }],
  }
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: ({ matches }: { matches: HeadMatch[] }) => buildHead(matches),
  beforeLoad: async (ctx) => {
    const { userId, token } = await fetchClerkAuth()
    if (token) {
      ctx.context.convexQueryClient.serverHttpClient?.setAuth(token)
    }
    return { userId, token }
  },
  shellComponent: RootDocument,
  component: RootComponent,
})

function RootComponent() {
  const { convexClient } = Route.useRouteContext()
  const isSsoCallback = useRouterState({
    select: (s) => s.location.pathname === '/sso-callback',
  })
  return (
    <ClerkProvider>
      <ConvexProviderWithClerk client={convexClient} useAuth={useAppAuth}>
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
        {import.meta.env.DEV ? (
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
        ) : null}
        <Scripts />
      </body>
    </html>
  )
}
