import { httpRouter } from 'convex/server'

import { httpAction } from './_generated/server'
import { devAuthEnabled, devAuthPublicJwks, mintDevToken } from './devAuth'

const http = httpRouter()

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

http.route({
  path: '/dev-auth/jwks.json',
  method: 'GET',
  handler: httpAction(async () =>
    devAuthEnabled() ? json(devAuthPublicJwks()) : json({ error: 'off' }, 404),
  ),
})

http.route({
  path: '/dev-auth/token',
  method: 'OPTIONS',
  handler: httpAction(
    async () => new Response(null, { status: 204, headers: CORS }),
  ),
})

http.route({
  path: '/dev-auth/token',
  method: 'POST',
  handler: httpAction(async (_ctx, request) => {
    if (!devAuthEnabled()) return json({ error: 'off' }, 404)
    const body = await request.json().catch(() => null)
    const email =
      typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    if (!email || !password)
      return json({ error: 'email and password required' }, 400)
    return json({ token: await mintDevToken(email) })
  }),
})

export default http
