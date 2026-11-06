import { useAuth } from '@clerk/tanstack-react-start'

import { DEV_AUTH_ENABLED } from '#/feature-flags'
import { fetchDevToken, useDevCredentials } from './dev-session'

function useAppAuthWithDev() {
  const clerk = useAuth()
  const credentials = useDevCredentials()
  if (!credentials) return clerk
  return {
    isLoaded: true,
    isSignedIn: true,
    orgId: credentials.email,
    orgRole: null,
    sessionClaims: null,
    getToken: () => fetchDevToken(credentials),
  }
}

export const useAppAuth = DEV_AUTH_ENABLED ? useAppAuthWithDev : useAuth
