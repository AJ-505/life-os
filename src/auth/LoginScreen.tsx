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
import { DEV_AUTH_ENABLED } from '#/feature-flags'
import { DevSignIn } from './DevSignIn'
import { RETURN_PATH } from './return-path'

export function LoginScreen() {
  const router = useRouter()
  const { signIn, fetchStatus } = useSignIn()
  const [busy, setBusy] = useState(false)

  const isLoading = fetchStatus === 'fetching'

  const google = async () => {
    if (isLoading || busy) return
    setBusy(true)

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
          toast.warning('You are already signed in. Redirecting…')
          window.location.reload()
          return
        }

        toast.error('Could not start Google sign-in.', {
          description: error instanceof Error ? error.message : String(error),
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
          <Button
            className="w-full"
            disabled={busy || isLoading}
            onClick={google}
          >
            {busy
              ? 'Redirecting…'
              : isLoading
                ? 'Setting things up..'
                : 'Continue with Google'}
          </Button>
          {}
          <div id="clerk-captcha" />
          {DEV_AUTH_ENABLED ? <DevSignIn /> : null}
        </CardContent>
      </Card>
    </div>
  )
}
