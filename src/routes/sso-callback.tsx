import { createFileRoute } from '@tanstack/react-router'
import { AuthenticateWithRedirectCallback } from '@clerk/tanstack-react-start'

/**
 * Clerk redirects here after Google sign-in. <AuthenticateWithRedirectCallback>
 * completes the OAuth handshake and then navigates to redirectUrlComplete (`/`),
 * so this route just needs to mount it and show a spinner meanwhile.
 */
export const Route = createFileRoute('/sso-callback')({
  component: SsoCallback,
})

function SsoCallback() {
  return (
    <>
      <AuthenticateWithRedirectCallback signInForceRedirectUrl="/" />
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Signing you in…
      </div>
    </>
  )
}
