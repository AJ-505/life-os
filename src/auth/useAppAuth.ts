import { useAuth } from '@clerk/tanstack-react-start'

import { DEV_AUTH_ENABLED } from '#/feature-flags'
import { fetchDevToken, useDevEmail } from './dev-session'

function useAppAuthWithDev() {
  const clerk = useAuth()
  const email = useDevEmail()
  if (!email) return clerk
  return {
    isLoaded: true,
    isSignedIn: true,
    orgId: email,
    orgRole: null,
    sessionClaims: null,
    getToken: () => fetchDevToken(email),
  }
}

export const useAppAuth = DEV_AUTH_ENABLED ? useAppAuthWithDev : useAuth
