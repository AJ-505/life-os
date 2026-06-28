import { useCallback, useEffect, useMemo, useState } from 'react'
import { createShooAuth, decodeIdentityClaims } from '@shoojs/react'

import type { StartSignInOptions } from '@shoojs/react'

/**
 * shoo (https://shoo.dev) — zero-config Google sign-in. It issues an ES256
 * id_token that Convex validates via JWKS (see convex/auth.config.ts), so there
 * is no client secret and no Google Console setup.
 *
 * `useAuth` is the adapter for `ConvexProviderWithAuth`; `signIn`/`signOut`
 * drive the login screen and sidebar. The adapter is browser-only (it reads
 * localStorage and window), so it's mounted behind a client gate (router.tsx).
 *
 * We pass an explicit `redirectUri` (derived from the live origin in the
 * browser) so construction never touches `window` during SSR, and so the flow
 * works on any deployment without configuration. The token audience is
 * `origin:<this origin>`, which must match SHOO_AUD on the Convex deployment.
 *
 * Shoo's id_token is short-lived and Shoo refreshes by redirecting through its
 * authorize endpoint, not by silently returning a new token to JavaScript.
 * Convex asks auth adapters for a fresh token after accepting a cached one and
 * before expiry. Returning `null` there makes Convex mark the user signed out,
 * so this adapter keeps returning the current valid token and independently
 * schedules a Shoo round-trip before it expires.
 */
const origin =
  typeof window !== 'undefined'
    ? window.location.origin
    : 'http://localhost:3000' // SSR placeholder; the real value comes from the browser

const client = createShooAuth({
  redirectUri: `${origin}/shoo/callback`,
  callbackPath: '/shoo/callback',
  requestPii: true,
})

export const REMEMBERED_AUTH_KEY = 'lifeos_remembered_auth'
const LEGACY_WAS_AUTHED_KEY = 'lifeos_was_authed'
const LEGACY_REAUTH_AT_KEY = 'lifeos_reauth_at'
const REFRESH_BEFORE_EXPIRY_MS = 5_000
const MIN_REFRESH_DELAY_MS = 1_000

type StoredTokenState = {
  userId: string | null
  token: string | null
  expiresAtMs: number | null
}

function readStoredTokenState(): StoredTokenState {
  const identity = client.getIdentity()
  const token = identity.token ?? null
  if (!token) return { userId: identity.userId, token: null, expiresAtMs: null }
  const claims = decodeIdentityClaims(token)
  return {
    userId: identity.userId,
    token,
    expiresAtMs: typeof claims?.exp === 'number' ? claims.exp * 1000 : null,
  }
}

function isExpired(expiresAtMs: number | null) {
  return expiresAtMs !== null && expiresAtMs <= Date.now()
}

function expiresSoon(expiresAtMs: number | null) {
  return (
    expiresAtMs !== null && expiresAtMs - Date.now() <= REFRESH_BEFORE_EXPIRY_MS
  )
}

function refreshDelay(expiresAtMs: number | null) {
  if (expiresAtMs === null) return null
  return Math.max(
    MIN_REFRESH_DELAY_MS,
    expiresAtMs - Date.now() - REFRESH_BEFORE_EXPIRY_MS,
  )
}

function currentRoute() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

export function rememberAuth() {
  window.localStorage.setItem(REMEMBERED_AUTH_KEY, '1')
  window.sessionStorage.setItem(LEGACY_WAS_AUTHED_KEY, '1')
  window.sessionStorage.removeItem(LEGACY_REAUTH_AT_KEY)
}

export function forgetAuth() {
  window.localStorage.removeItem(REMEMBERED_AUTH_KEY)
  window.sessionStorage.removeItem(LEGACY_WAS_AUTHED_KEY)
  window.sessionStorage.removeItem(LEGACY_REAUTH_AT_KEY)
}

export function hasRememberedAuth() {
  return (
    window.localStorage.getItem(REMEMBERED_AUTH_KEY) === '1' ||
    window.sessionStorage.getItem(LEGACY_WAS_AUTHED_KEY) === '1'
  )
}

let reauthInFlight: Promise<void> | null = null
let callbackInFlight: Promise<void> | null = null

function beginReauth() {
  if (reauthInFlight) return reauthInFlight
  if (window.location.pathname === client.options.callbackPath) {
    return Promise.resolve()
  }
  rememberAuth()
  reauthInFlight = client
    .startSignIn({ returnTo: currentRoute() })
    .then(() => undefined)
    .finally(() => {
      reauthInFlight = null
    })
  return reauthInFlight
}

function handleCallbackOnce() {
  if (!callbackInFlight) {
    callbackInFlight = client
      .handleCallback()
      .then(() => undefined)
      .catch((error) => {
        console.error('Could not finish Shoo sign-in callback.', error)
      })
  }
  return callbackInFlight
}

export function useAuth() {
  const [isLoading, setIsLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    const state = readStoredTokenState()
    return (
      state.userId !== null &&
      state.token !== null &&
      !isExpired(state.expiresAtMs)
    )
  })

  useEffect(() => {
    let cancelled = false

    handleCallbackOnce().finally(() => {
      if (cancelled) return
      const state = readStoredTokenState()
      const authenticated =
        state.userId !== null &&
        state.token !== null &&
        !isExpired(state.expiresAtMs)
      if (authenticated) rememberAuth()
      setIsAuthenticated(authenticated)
      setIsLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (isLoading || !isAuthenticated) return
    const state = readStoredTokenState()
    const delay = refreshDelay(state.expiresAtMs)
    if (delay === null) return

    const refresh = () => {
      if (!hasRememberedAuth()) return
      const nextState = readStoredTokenState()
      if (
        isExpired(nextState.expiresAtMs) ||
        expiresSoon(nextState.expiresAtMs)
      ) {
        void beginReauth().catch(() => setIsAuthenticated(false))
      }
    }

    const timeout = window.setTimeout(refresh, delay)
    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refreshOnFocus)
    return () => {
      window.clearTimeout(timeout)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refreshOnFocus)
    }
  }, [isAuthenticated, isLoading])

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      const state = readStoredTokenState()
      if (!state.token || state.userId === null) {
        if (hasRememberedAuth()) {
          void beginReauth().catch(() => setIsAuthenticated(false))
        } else {
          setIsAuthenticated(false)
        }
        return null
      }

      if (isExpired(state.expiresAtMs)) {
        if (hasRememberedAuth()) {
          void beginReauth().catch(() => setIsAuthenticated(false))
          setIsAuthenticated(true)
          return state.token
        }
        client.clearIdentity()
        setIsAuthenticated(false)
        return null
      }

      rememberAuth()
      setIsAuthenticated(true)
      if (forceRefreshToken && expiresSoon(state.expiresAtMs)) {
        void beginReauth().catch(() => setIsAuthenticated(false))
      }
      return state.token
    },
    [],
  )

  return useMemo(
    () => ({ isLoading, isAuthenticated, fetchAccessToken }),
    [fetchAccessToken, isAuthenticated, isLoading],
  )
}

export async function signIn(opts?: StartSignInOptions) {
  rememberAuth()
  await client.startSignIn(opts)
}

export function signOut() {
  forgetAuth()
  client.clearIdentity()
  window.location.reload()
}
