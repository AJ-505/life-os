const ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const
const APPLICATION_ID = 'lifeos-dev'
const SESSION_SECONDS = 60 * 60 * 24

export function devAuthEnabled() {
  return (
    process.env.DEV_AUTH_ENABLED === '1' && !!process.env.DEV_AUTH_PRIVATE_JWK
  )
}

export function devAuthIssuer() {
  return process.env.CONVEX_SITE_URL!
}

export function devAuthProviders() {
  if (!devAuthEnabled()) return []
  const issuer = devAuthIssuer()
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

function base64Url(input: ArrayBuffer | string) {
  const bytes =
    typeof input === 'string'
      ? new TextEncoder().encode(input)
      : new Uint8Array(input)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function devAuthPublicJwks() {
  const { n, e } = JSON.parse(process.env.DEV_AUTH_PRIVATE_JWK!)
  return {
    keys: [{ kty: 'RSA', n, e, alg: 'RS256', use: 'sig', kid: 'lifeos-dev' }],
  }
}

export async function mintDevToken(email: string) {
  const key = await crypto.subtle.importKey(
    'jwk',
    JSON.parse(process.env.DEV_AUTH_PRIVATE_JWK!),
    ALGORITHM,
    false,
    ['sign'],
  )
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(
    JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'lifeos-dev' }),
  )
  const payload = base64Url(
    JSON.stringify({
      iss: devAuthIssuer(),
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
