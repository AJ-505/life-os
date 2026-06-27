/**
 * Convex trusts shoo (https://shoo.dev) as a custom JWT issuer — no client
 * secret, no Google Console. shoo signs ES256 id_tokens and publishes a JWKS;
 * Convex validates the signature, issuer, and audience on every request.
 *
 * The audience is shoo's origin-scoped value: `origin:<your app origin>`.
 * Defaults to the dev origin; set SHOO_AUD on the deployment for prod:
 *   npx convex env set SHOO_AUD origin:https://your-domain
 */
export default {
  providers: [
    {
      type: 'customJwt',
      issuer: 'https://shoo.dev',
      jwks: 'https://shoo.dev/.well-known/jwks.json',
      algorithm: 'ES256',
      applicationID: process.env.SHOO_AUD ?? 'origin:http://localhost:3000',
    },
  ],
}
