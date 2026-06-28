import { createShooConvexAuth } from '@shoojs/react'

const origin =
  typeof window !== 'undefined'
    ? window.location.origin
    : 'http://localhost:3000'

export const { useAuth, signIn, signOut } = createShooConvexAuth({
  redirectUri: `${origin}/shoo/callback`,
  callbackPath: '/shoo/callback',
  requestPii: true,
})
