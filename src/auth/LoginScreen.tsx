import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useClerk, useSignIn } from '@clerk/tanstack-react-start'
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
 * A click has to survive two dead ends this screen can be in. Clerk refuses to
 * start a sign-in while the client holds a session (`session_exists`), and it
 * silently reuses a leftover sign-in attempt it cannot complete. Both resolve
 * with no redirect and no navigation, which is what made this button look dead.
 * Clearing the client fixes the first outright. The second keeps its dead attempt
 * on the wrapper this component already holds, so that click clears the client and
 * reloads, and the click after it reaches Google.
 */
export function LoginScreen() {
  const router = useRouter()
  const { signIn, fetchStatus } = useSignIn()
  const { signOut } = useClerk()
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

    /**
     * One attempt at the OAuth redirect. A live attempt leaves the first factor
     * verification with an external redirect URL for Google; a dead one comes
     * back with no redirect at all, whether it failed or silently reused an
     * attempt it could not finish.
     */
    const attempt = async () => {
      const { error } = await signIn.sso({
        strategy: 'oauth_google',
        redirectUrl: '/',
        redirectCallbackUrl: callback,
      })
      const redirected = Boolean(
        signIn.firstFactorVerification.externalVerificationRedirectURL,
      )
      return { error, redirected }
    }

    try {
      let { error, redirected } = await attempt()

      if (!redirected) {
        // Drop the session Clerk will not work around: this screen only renders
        // when the app's backend did not accept the identity that session carries.
        // Drop a half-finished attempt too. `signOut(callback)` is the overload that
        // skips signOut's own redirect, so the retry still runs in this click.
        await signOut(() => {})
        if (signIn.id) await signIn.reset()
        ;({ error, redirected } = await attempt())
      }

      if (error) {
        toast.error(error.message || 'Could not start Google sign-in.')
      } else if (!redirected) {
        // Clerk keeps reusing an attempt it cannot complete. The client is clean
        // now, so this reload cannot land back in the same dead end.
        window.location.reload()
      }
    } catch {
      toast.error('Could not start Google sign-in.')
    }
    setBusy(false)
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
