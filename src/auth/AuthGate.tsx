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

function LoadingScreen({ label = 'Loading your board…' }: { label?: string }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3">
      <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  )
}

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
