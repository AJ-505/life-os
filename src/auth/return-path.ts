import * as z from 'zod'

/**
 * The page a visitor was on when the login screen took over, carried through
 * Clerk's handshake as a search param on /sso-callback.
 *
 * It has to travel as a param because Clerk's `redirectUrlComplete` is a prop,
 * and in Clerk's own precedence a prop beats the `redirectUrl` stored on the
 * sign-in attempt — which is why the old hardcoded `/` on /sso-callback pinned
 * every sign-in to the home board. The callback URL's own search params do
 * survive the round trip, so that is where the page rides.
 *
 * Named `redirect` rather than Clerk's own `redirect_url`: Clerk reads the
 * latter off the callback URL for its own redirect precedence, and this value
 * is deliberately ours to resolve.
 */
export const RETURN_PATH = 'redirect'

/**
 * Search shape for /sso-callback.
 *
 * The value ends up as a redirect target, so a bare `startsWith('/')` is not
 * enough: `//evil.test` is protocol-relative and browsers read it as another
 * origin.
 *
 * A value that fails is dropped rather than rejected, so a mangled link still
 * mounts the route and completes the sign-in on the home board. Rejecting it
 * would stop the callback mounting at all, which costs the visitor the sign-in
 * rather than just the destination.
 */
export const ssoCallbackSearch = z.object({
  [RETURN_PATH]: z
    .string()
    .max(2048)
    .refine(
      (raw) =>
        raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\'),
      { message: 'must be a path on this origin' },
    )
    .optional()
    .catch(undefined),
})
