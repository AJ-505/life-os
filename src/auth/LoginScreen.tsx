import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '#/design-system/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/design-system/ui/card'

import { signIn } from './shoo'

/**
 * The whole app sits behind this. shoo handles Google sign-in end to end
 * (PKCE + redirect + token), so there's nothing to configure — one button.
 */
export function LoginScreen() {
  const [busy, setBusy] = useState(false)

  const google = async () => {
    setBusy(true)
    try {
      await signIn() // redirects to shoo, then back to /shoo/callback
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
          <Button className="w-full" disabled={busy} onClick={google}>
            {busy ? 'Redirecting…' : 'Continue with Google'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
