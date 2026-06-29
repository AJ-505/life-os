import type { AuthConfig } from 'convex/server'

/**
 * Convex trusts Clerk as the JWT issuer. With Clerk's native Convex integration
 * (Clerk dashboard → Configure → Integrations → Convex → Activate), every Clerk
 * session token carries `aud: "convex"`, so there is no hand-built JWT template
 * to maintain. Convex fetches Clerk's JWKS, then validates the signature, issuer
 * and audience on every request.
 *
 * `CLERK_JWT_ISSUER_DOMAIN` is the Clerk Frontend API URL (e.g.
 * `https://verb-noun-00.clerk.accounts.dev` in dev). It must be set on the
 * Convex deployment — NOT in .env.local:
 *   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your>.clerk.accounts.dev
 */
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: 'convex',
    },
  ],
} satisfies AuthConfig
