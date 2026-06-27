import { useEffect, useState } from 'react'
import {
  Authenticated,
  AuthLoading,
  ConvexProviderWithAuth,
  Unauthenticated,
} from 'convex/react'

import { LoginScreen } from './LoginScreen'
import { useAuth } from './shoo'

import type { ConvexReactClient } from 'convex/react'
import type { ReactNode } from 'react'

function LoadingScreen() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3">
      <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
      <span className="text-sm text-muted-foreground">Loading your board…</span>
    </div>
  )
}

/**
 * The whole app sits behind this gate. shoo's auth adapter is browser-only, so
 * `ConvexProviderWithAuth` must not render during SSR — this mounts it only
 * after hydration. It lives *inside* the document body (rendered by __root's
 * RootDocument), so the HTML shell + stylesheet always server-render; only the
 * authenticated subtree is client-gated.
 *
 * Once mounted, Convex resolves the shoo identity: loading → branded screen,
 * signed-out → login, signed-in → the board (`children`).
 */
export function AuthGate({
  client,
  children,
}: {
  client: ConvexReactClient
  children: ReactNode
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return <LoadingScreen />

  return (
    <ConvexProviderWithAuth client={client} useAuth={useAuth}>
      <AuthLoading>
        <LoadingScreen />
      </AuthLoading>
      <Unauthenticated>
        <LoginScreen />
      </Unauthenticated>
      <Authenticated>{children}</Authenticated>
    </ConvexProviderWithAuth>
  )
}
