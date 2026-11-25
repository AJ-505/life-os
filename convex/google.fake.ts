import * as z from 'zod'

import { GOOGLE_EVENTS_SCOPE } from './syncRule'

const EVENTS_URL =
  'https://www.googleapis.com/calendar/v3/calendars/primary/events'

type Method = 'POST' | 'PATCH' | 'DELETE' | 'GET'

type Refusal = { method: Method; status: number; times: number }

const sentEvent = z.looseObject({
  id: z.string().default(''),
  summary: z.string().optional(),
  status: z.string().optional(),
})

export type FakeEvent = z.infer<typeof sentEvent>

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

export function fakeGoogle(options: { connected?: boolean } = {}) {
  const events = new Map<string, FakeEvent>()
  const refusals: Array<Refusal> = []
  const calls: Array<{ method: string; url: string }> = []

  const refused = (method: string) => {
    const refusal = refusals.find(
      (candidate) => candidate.method === method && candidate.times > 0,
    )
    if (!refusal) return null
    refusal.times -= 1
    return new Response('{}', { status: refusal.status })
  }

  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.includes('api.clerk.com')) {
      if (options.connected === false) return json({}, 404)
      return json([
        {
          token: 'google-token',
          scopes: [GOOGLE_EVENTS_SCOPE],
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      ])
    }
    if (!url.startsWith(EVENTS_URL)) return json({}, 500)
    calls.push({ method, url })
    const failure = refused(method)
    if (failure) return failure

    const body = sentEvent.parse(
      typeof init?.body === 'string' ? JSON.parse(init.body) : {},
    )
    const id = url.slice(EVENTS_URL.length + 1).split('?')[0]

    if (method === 'POST') {
      if (events.has(body.id)) return json({}, 409)
      events.set(body.id, body)
      return json({ id: body.id, htmlLink: `https://cal/${body.id}` })
    }
    if (method === 'PATCH') {
      const existing = events.get(id)
      if (!existing) return json({}, 404)
      events.set(id, { ...existing, ...body, id })
      return json({ id, htmlLink: `https://cal/${id}` })
    }
    if (method === 'DELETE') {
      if (!events.delete(id)) return json({}, 410)
      return new Response(null, { status: 204 })
    }
    return json({ items: [...events.values()] })
  }

  return {
    fetch,
    events,
    calls,
    refuse: (method: Method, status: number, times = Infinity) => {
      refusals.push({ method, status, times })
    },
    count: (method: Method) =>
      calls.filter((call) => call.method === method).length,
  }
}
