import { createFileRoute } from '@tanstack/react-router'
import { AuthenticateWithRedirectCallback } from '@clerk/tanstack-react-start'

import { RETURN_PATH, ssoCallbackSearch } from '#/auth/return-path'

/**
 * Clerk redirects here after Google sign-in. <AuthenticateWithRedirectCallback>
 * completes the OAuth handshake and then navigates to redirectUrlComplete, so
 * this route mounts it and shows a spinner meanwhile.
 *
 * That destination is a forced prop, which beats the `redirectUrl` stored on
 * the sign-in attempt — a prop beats search params and options in Clerk's own
 * precedence, so the old hardcoded `/` here is what sent every visitor to the
 * home board no matter where they started. The page they were on arrives on
 * this route's own params instead.
 */
export const Route = createFileRoute('/sso-callback')({
  validateSearch: ssoCallbackSearch,
  component: SsoCallback,
})

function SsoCallback() {
  const search = Route.useSearch()

  return (
    <>
      <AuthenticateWithRedirectCallback
        signInForceRedirectUrl={search[RETURN_PATH] ?? '/'}
      />
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Signing you in…
      </div>
    </>
  )
}
