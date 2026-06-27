import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { Toaster } from 'sonner'

import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'

import { THEME_INIT_SCRIPT, ThemeProvider } from '#/design-system'
import { AppShell, UpdateWatcher } from '#/shell'
import { AuthGate } from '#/auth'

import appCss from '../styles.css?url'

import type { QueryClient } from '@tanstack/react-query'
import type { ConvexReactClient } from 'convex/react'

interface MyRouterContext {
  queryClient: QueryClient
  convexClient: ConvexReactClient
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      { title: 'LifeOS' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
    scripts: [{ children: THEME_INIT_SCRIPT }],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
})

/** The entire app lives behind a signed-in identity. AuthGate (client-only,
 *  inside the document body) resolves the shoo identity and renders the board
 *  only when authenticated — no per-route guards, no SSR token dance. */
function RootComponent() {
  const { convexClient } = Route.useRouteContext()
  return (
    <AuthGate client={convexClient}>
      <AppShell>
        <Outlet />
      </AppShell>
    </AuthGate>
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
        <UpdateWatcher />
        <TanStackDevtools
          config={{ position: 'bottom-left' }}
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
