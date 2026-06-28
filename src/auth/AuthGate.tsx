import { useEffect, useRef, useState } from 'react'
import {
  Authenticated,
  AuthLoading,
  ConvexProviderWithAuth,
  Unauthenticated,
} from 'convex/react'

import { LoginScreen } from './LoginScreen'
import { hasRememberedAuth, rememberAuth, signIn, useAuth } from './shoo'

import type { ConvexReactClient } from 'convex/react'
import type { ReactNode } from 'react'

function LoadingScreen({ label = 'Loading your board…' }: { label?: string }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3">
      <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  )
}

function MarkAuthed({ children }: { children: ReactNode }) {
  useEffect(() => {
    rememberAuth()
  }, [])
  return <>{children}</>
}

/**
 * If a remembered LifeOS login has no usable local token (for example after the
 * browser was closed past the JWT expiry), round-trip through shoo to mint a
 * fresh one. Explicit sign-out clears the marker, so this only runs for users
 * who have not asked to leave the app.
 */
function ReauthOrLogin() {
  const [redirecting, setRedirecting] = useState(false)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    if (hasRememberedAuth()) {
      setRedirecting(true)
      void signIn().catch(() => setRedirecting(false))
    }
  }, [])

  return redirecting ? (
    <LoadingScreen label="Refreshing your session…" />
  ) : (
    <LoginScreen />
  )
}

/**
 * The whole app sits behind this gate. shoo's auth adapter is browser-only, so
 * `ConvexProviderWithAuth` must not render during SSR — this mounts it only
 * after hydration. It lives *inside* the document body (rendered by __root's
 * RootDocument), so the HTML shell + stylesheet always server-render; only the
 * authenticated subtree is client-gated.
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
        <ReauthOrLogin />
      </Unauthenticated>
      <Authenticated>
        <MarkAuthed>{children}</MarkAuthed>
      </Authenticated>
    </ConvexProviderWithAuth>
  )
}
