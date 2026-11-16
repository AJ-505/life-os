import { createFileRoute } from '@tanstack/react-router'
import { AuthenticateWithRedirectCallback } from '@clerk/tanstack-react-start'

import { RETURN_PATH, ssoCallbackSearch } from '#/auth/return-path'

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
