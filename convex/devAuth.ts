import * as z from 'zod'

const ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const
const APPLICATION_ID = 'lifeos-dev'
const KEY_ID = 'lifeos-dev'
const SESSION_SECONDS = 60 * 60 * 24
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

export const DEV_SITE_HOST = 'elated-egret-903.convex.site'

export const DevSignInBody = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1),
})

function onDevHost() {
  const site = process.env.CONVEX_SITE_URL
  return !!site && new URL(site).hostname === DEV_SITE_HOST
}

export function devAuthAllowed() {
  return (
    onDevHost() &&
    process.env.DEV_AUTH_ENABLED === '1' &&
    !!process.env.DEV_AUTH_PRIVATE_JWK &&
    !!process.env.DEV_AUTH_PASSWORD
  )
}

export function devAuthProviders() {
  if (!onDevHost() || !devAuthAllowed()) return []
  const issuer = process.env.CONVEX_SITE_URL!
  return [
    {
      type: 'customJwt' as const,
      applicationID: APPLICATION_ID,
      issuer,
      jwks: `${issuer}/dev-auth/jwks.json`,
      algorithm: 'RS256' as const,
    },
  ]
}

export function allowedCorsOrigin(origin: string | null) {
  return origin !== null && LOCAL_ORIGIN.test(origin) ? origin : null
}

function base64Url(input: ArrayBuffer | string) {
  const bytes =
    typeof input === 'string'
      ? new TextEncoder().encode(input)
      : new Uint8Array(input)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function publicJwk() {
  const { n, e } = z
    .object({ n: z.string(), e: z.string() })
    .parse(JSON.parse(process.env.DEV_AUTH_PRIVATE_JWK!))
  return { kty: 'RSA', n, e, alg: 'RS256', use: 'sig', kid: KEY_ID }
}

export function devAuthPublicJwks() {
  return { keys: [publicJwk()] }
}

async function sha256(text: string) {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  )
}

export async function passwordMatches(given: string) {
  const [a, b] = await Promise.all([
    sha256(given),
    sha256(process.env.DEV_AUTH_PASSWORD!),
  ])
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i]
  return difference === 0
}

export async function mintDevToken(email: string) {
  const key = await crypto.subtle.importKey(
    'jwk',
    JSON.parse(process.env.DEV_AUTH_PRIVATE_JWK!),
    ALGORITHM,
    false,
    ['sign'],
  )
  const issuer = process.env.CONVEX_SITE_URL!
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(
    JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KEY_ID }),
  )
  const payload = base64Url(
    JSON.stringify({
      iss: issuer,
      aud: APPLICATION_ID,
      sub: `dev|${email}`,
      email,
      iat: now,
      exp: now + SESSION_SECONDS,
    }),
  )
  const signature = await crypto.subtle.sign(
    ALGORITHM,
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  )
  return `${header}.${payload}.${base64Url(signature)}`
}
