import { LogOut } from 'lucide-react'

import { Button } from '#/design-system/ui/button'

import { signOut } from './shoo'

export function SignOutButton() {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="justify-start gap-2"
      onClick={() => signOut()}
    >
      <LogOut className="size-4" /> Sign out
    </Button>
  )
}
