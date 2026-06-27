import { createShooConvexAuth } from '@shoojs/react'

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
 */
const origin =
  typeof window !== 'undefined'
    ? window.location.origin
    : 'http://localhost:3000' // SSR placeholder; the real value comes from the browser

export const { useAuth, signIn, signOut } = createShooConvexAuth({
  redirectUri: `${origin}/shoo/callback`,
  callbackPath: '/shoo/callback',
  requestPii: true,
})
