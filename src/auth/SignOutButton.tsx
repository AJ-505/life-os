import { LogOut } from 'lucide-react'
import { useClerk } from '@clerk/tanstack-react-start'

import { Button } from '#/design-system/ui/button'
import { DEV_AUTH_ENABLED } from '#/feature-flags'
import { readDevCredentials, signOutDev } from './dev-session'

export function SignOutButton() {
  const { signOut } = useClerk()
  return (
    <Button
      variant="ghost"
      size="sm"
      className="justify-start gap-2"
      onClick={() => {
        if (DEV_AUTH_ENABLED && readDevCredentials()) signOutDev()
        else signOut({ redirectUrl: '/' })
      }}
    >
      <LogOut className="size-4" /> Sign out
    </Button>
  )
}
