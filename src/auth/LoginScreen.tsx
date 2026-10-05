import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useSignIn } from '@clerk/tanstack-react-start'
import { isClerkAPIResponseError } from '@clerk/tanstack-react-start/errors'
import { toast } from 'sonner'

import { Button } from '#/design-system/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/design-system/ui/card'
import { RETURN_PATH } from './return-path'

/**
 * The whole app sits behind this. One button kicks off Clerk's Google OAuth
 * redirect; Clerk bounces back to /sso-callback (see routes/sso-callback.tsx),
 * which finishes the handshake and lands on the page the visitor was sent —
 * a shared space, not just the home board. Enabling Google itself is a Clerk
 * dashboard toggle (User & authentication → SSO connections → Google).
 *
 * A click has to survive one dead end: Clerk refuses to start a sign-in while
 * the client holds a session (`session_exists`), which resolves with no redirect
 * and no navigation, and is what made this button look dead. The client is stale
 * at that point, so a reload clears it.
 */
export function LoginScreen() {
  const router = useRouter()
  const { signIn, fetchStatus } = useSignIn()
  const [busy, setBusy] = useState(false)

  const isLoading = fetchStatus === 'fetching'

  const google = async () => {
    if (isLoading || busy) return
    setBusy(true)

    /**
     * Whoever is on this screen got here by following a link — a shared space,
     * most of all — so the board they were sent is the board they land on once
     * Google is done. It rides the callback URL so it survives the round trip;
     * /sso-callback reads it from there.
     */
    const here = router.state.location.href
    const callback =
      here === '/'
        ? '/sso-callback'
        : `/sso-callback?${RETURN_PATH}=${encodeURIComponent(here)}`

    try {
      const { error } = await signIn.sso({
        strategy: 'oauth_google',
        redirectUrl: '/',
        redirectCallbackUrl: callback,
      })

      if (error) {
        const hasActiveSession =
          isClerkAPIResponseError(error) &&
          error.errors.some((err) => err.code === 'session_exists')

        if (hasActiveSession) {
          toast.warning('You are already signed in. Refreshing your session…')
          window.location.reload()
          return
        }

        toast.error('Could not start Google sign-in.', {
          description:
            error instanceof Error ? error.message : String(error),
        })
      }
    } catch (error) {
      toast.error('Could not start Google sign-in.', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">LifeOS</CardTitle>
          <CardDescription>Sign in to your board</CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" disabled={busy || isLoading} onClick={google}>
            {busy
              ? 'Redirecting…'
              : isLoading
                ? 'Setting things up..'
                : 'Continue with Google'}
          </Button>
          {/* Clerk mounts its bot-protection (Smart CAPTCHA) widget here during
              the custom sign-in flow. Without this element Clerk warns and falls
              back to an invisible widget. */}
          <div id="clerk-captcha" />
        </CardContent>
      </Card>
    </div>
  )
}
