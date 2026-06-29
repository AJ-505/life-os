import { useState } from 'react'
import { useSignIn } from '@clerk/tanstack-react-start/legacy'
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
  const { signIn, isLoaded } = useSignIn()
  const [busy, setBusy] = useState(false)

  const google = async () => {
    if (!isLoaded) return
    setBusy(true)
    try {
      await signIn.authenticateWithRedirect({
        strategy: 'oauth_google',
        redirectUrl: '/sso-callback',
        redirectUrlComplete: '/',
      })
    } catch {
      toast.error('Could not start Google sign-in.')
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
          <Button
            className="w-full"
            disabled={busy || !isLoaded}
            onClick={google}
          >
            {busy ? 'Redirecting…' : 'Continue with Google'}
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
