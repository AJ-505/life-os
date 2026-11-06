import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEV_SITE_HOST, devAuthProviders } from './devAuth'
import schema from './schema'

const modules = import.meta.glob([
  './**/*.ts',
  '!./**/*.test.ts',
  '!./test.setup.ts',
])

const DEV_SITE = `https://${DEV_SITE_HOST}`
const PROD_LIKE_SITE = 'https://other-name-123.convex.site'
const PASSWORD = 'correct-horse-battery-staple'
const TOKEN_PATH = '/dev-auth/token'

let savedEnv: NodeJS.ProcessEnv = {}

function enableDevAuth(site: string) {
  process.env.CONVEX_SITE_URL = site
  process.env.DEV_AUTH_ENABLED = '1'
  process.env.DEV_AUTH_PASSWORD = PASSWORD
  process.env.DEV_AUTH_PRIVATE_JWK = JSON.stringify(testKey.jwk)
}

let testKey: { jwk: JsonWebKey }

beforeEach(async () => {
  savedEnv = { ...process.env }
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )
  testKey = { jwk: await crypto.subtle.exportKey('jwk', pair.privateKey) }
})

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key]
  }
  Object.assign(process.env, savedEnv)
})

const signIn = (
  t: ReturnType<typeof convexTest>,
  body: unknown,
  origin?: string,
) =>
  t.fetch(TOKEN_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify(body),
  })

describe('dev auth allowlist', () => {
  it('names the dev deployment host and nothing else', () => {
    expect(DEV_SITE_HOST).toBe('elated-egret-903.convex.site')
  })

  it('offers a provider on the allowlisted host', () => {
    enableDevAuth(DEV_SITE)
    expect(devAuthProviders()).toHaveLength(1)
  })

  it('offers no provider on any other host, even fully configured', () => {
    enableDevAuth(PROD_LIKE_SITE)
    expect(devAuthProviders()).toEqual([])
  })

  it('offers no provider without the password', () => {
    enableDevAuth(DEV_SITE)
    delete process.env.DEV_AUTH_PASSWORD
    expect(devAuthProviders()).toEqual([])
  })

  it('offers no provider when the flag is off', () => {
    enableDevAuth(DEV_SITE)
    process.env.DEV_AUTH_ENABLED = '0'
    expect(devAuthProviders()).toEqual([])
  })
})

describe('dev auth token route', () => {
  it('is a 404 on a host outside the allowlist, even with the right password', async () => {
    enableDevAuth(PROD_LIKE_SITE)
    const t = convexTest(schema, modules)
    const response = await signIn(t, {
      email: 'me@example.com',
      password: PASSWORD,
    })
    expect(response.status).toBe(404)
  })

  it('refuses a wrong password with 401', async () => {
    enableDevAuth(DEV_SITE)
    const t = convexTest(schema, modules)
    const response = await signIn(t, {
      email: 'me@example.com',
      password: 'dev',
    })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'wrong password' })
  })

  it('rejects a malformed body with 400', async () => {
    enableDevAuth(DEV_SITE)
    const t = convexTest(schema, modules)
    const badEmail = await signIn(t, {
      email: 'not-an-email',
      password: PASSWORD,
    })
    expect(badEmail.status).toBe(400)
    const noPassword = await signIn(t, { email: 'me@example.com' })
    expect(noPassword.status).toBe(400)
  })

  it('mints a token for the right password on the allowlisted host', async () => {
    enableDevAuth(DEV_SITE)
    const t = convexTest(schema, modules)
    const response = await signIn(t, {
      email: '  Me@Example.com ',
      password: PASSWORD,
    })
    expect(response.status).toBe(200)
    const { token } = (await response.json()) as { token: string }
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    )
    expect(payload).toMatchObject({
      iss: DEV_SITE,
      aud: 'lifeos-dev',
      sub: 'dev|me@example.com',
    })
  })

  it('serves the public key only on the allowlisted host', async () => {
    const t = convexTest(schema, modules)
    enableDevAuth(PROD_LIKE_SITE)
    expect((await t.fetch('/dev-auth/jwks.json')).status).toBe(404)
    enableDevAuth(DEV_SITE)
    expect((await t.fetch('/dev-auth/jwks.json')).status).toBe(200)
  })
})

describe('dev auth CORS', () => {
  it.each([
    'http://localhost:5174',
    'http://localhost',
    'http://127.0.0.1:5173',
  ])('echoes the local origin %s', async (origin) => {
    enableDevAuth(DEV_SITE)
    const t = convexTest(schema, modules)
    const response = await signIn(
      t,
      { email: 'me@example.com', password: PASSWORD },
      origin,
    )
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin)
  })

  it.each([
    'https://evil.example',
    'https://localhost.evil.example',
    'https://localhost:5174',
    'http://localhost.evil.example:5174',
    'http://192.168.1.10:5174',
  ])('sends no allow-origin header to %s', async (origin) => {
    enableDevAuth(DEV_SITE)
    const t = convexTest(schema, modules)
    const response = await signIn(
      t,
      { email: 'me@example.com', password: PASSWORD },
      origin,
    )
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('never answers with a wildcard origin', async () => {
    enableDevAuth(DEV_SITE)
    const t = convexTest(schema, modules)
    const response = await signIn(t, { email: 'me@example.com', password: 'x' })
    expect(response.headers.get('Access-Control-Allow-Origin')).not.toBe('*')
  })
})
