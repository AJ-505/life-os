import { LogOut } from 'lucide-react'

import { Button } from '#/design-system/ui/button'

import { forgetAuth, signOut } from './shoo'

export function SignOutButton() {
  const handleSignOut = () => {
    // Clear the remembered-login marker before the reload so AuthGate doesn't
    // immediately start a Shoo re-auth round-trip.
    forgetAuth()
    signOut()
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      className="justify-start gap-2"
      onClick={handleSignOut}
    >
      <LogOut className="size-4" /> Sign out
    </Button>
  )
}
