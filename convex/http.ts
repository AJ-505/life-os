import { httpRouter } from 'convex/server'

import { httpAction } from './_generated/server'
import {
  allowedCorsOrigin,
  devAuthAllowed,
  devAuthPublicJwks,
  DevSignInBody,
  mintDevToken,
  passwordMatches,
} from './devAuth'

const http = httpRouter()

const corsHeaders = (request: Request): Record<string, string> => {
  const origin = allowedCorsOrigin(request.headers.get('Origin'))
  if (!origin) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

const json = (request: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
  })

const notFound = () => new Response(null, { status: 404 })

http.route({
  path: '/dev-auth/jwks.json',
  method: 'GET',
  handler: httpAction(async () =>
    devAuthAllowed()
      ? new Response(JSON.stringify(devAuthPublicJwks()), {
          headers: { 'Content-Type': 'application/json' },
        })
      : notFound(),
  ),
})

http.route({
  path: '/dev-auth/token',
  method: 'OPTIONS',
  handler: httpAction(async (_ctx, request) =>
    devAuthAllowed()
      ? new Response(null, { status: 204, headers: corsHeaders(request) })
      : notFound(),
  ),
})

http.route({
  path: '/dev-auth/token',
  method: 'POST',
  handler: httpAction(async (_ctx, request) => {
    if (!devAuthAllowed()) return notFound()
    const body = DevSignInBody.safeParse(await request.json().catch(() => null))
    if (!body.success) return json(request, { error: 'invalid body' }, 400)
    if (!(await passwordMatches(body.data.password)))
      return json(request, { error: 'wrong password' }, 401)
    return json(request, { token: await mintDevToken(body.data.email) })
  }),
})

export default http
