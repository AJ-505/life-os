import { useState } from 'react'
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

/**
 * The whole app sits behind this. One button kicks off Clerk's Google OAuth
 * redirect; Clerk bounces back to /sso-callback (see routes/sso-callback.tsx),
 * which finishes the handshake and lands on `/`. Enabling Google itself is a
 * Clerk dashboard toggle (User & authentication → SSO connections → Google).
 */
export function LoginScreen() {
  const { signIn, fetchStatus } = useSignIn()
  const [busy, setBusy] = useState(false)

  const isLoading = fetchStatus === 'fetching'

  const google = async () => {
    if (isLoading) return
    setBusy(true)
    const { error } = await signIn.sso({
      strategy: 'oauth_google',
      redirectUrl: '/',
      redirectCallbackUrl: '/sso-callback',
    })

    if (error && isClerkAPIResponseError(error)) {
      const hasActiveSession = error.errors.some(
        (err) => err.code === 'session_exists',
      )

      if (hasActiveSession) {
        toast.warning('You are already signed in. Redirecting..')
        window.location.reload()
      }
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
          <Button className="w-full" disabled={isLoading} onClick={google}>
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
