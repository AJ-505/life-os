import { LogOut } from 'lucide-react'

import { Button } from '#/design-system/ui/button'

import { signOut } from './shoo'

export function SignOutButton() {
  const handleSignOut = () => {
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
