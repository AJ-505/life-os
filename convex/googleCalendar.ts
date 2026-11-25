import * as z from 'zod'

import { GOOGLE_EVENTS_SCOPE } from './syncRule'

import type { SyncIssue } from './taskModel'

const EVENTS_URL =
  'https://www.googleapis.com/calendar/v3/calendars/primary/events'

const MAX_PAGES = 20
const PAGE_SIZE = 250

export type SyncFailure = { ok: false; reason: SyncIssue; detail: string }

type Saved = { kind: 'saved'; id: string | null; link: string | null }
type Failed = { kind: 'failed'; failure: SyncFailure }

export type EventInsert = Saved | { kind: 'conflict' } | Failed

export type EventPatch = Saved | { kind: 'gone' } | Failed

export type EventRemoval = { kind: 'removed' } | Failed

export type EventListing = { ok: true; items: Array<unknown> } | SyncFailure

export type GoogleCalendar = {
  insert: (eventId: string, body: object) => Promise<EventInsert>
  patch: (eventId: string, body: object) => Promise<EventPatch>
  remove: (eventId: string) => Promise<EventRemoval>
  list: (from: number, to: number) => Promise<EventListing>
}

const clerkTokenEntry = z.object({
  token: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  expires_at: z.number().optional(),
  expiration: z.number().optional(),
})
const clerkTokenBody = z.union([
  z.array(clerkTokenEntry),
  z.object({ data: z.array(clerkTokenEntry).optional() }),
])
const writtenEvent = z.object({
  id: z.string().optional(),
  htmlLink: z.string().optional(),
  status: z.string().optional(),
})
const eventPage = z.object({
  items: z.array(z.unknown()).optional(),
  nextPageToken: z.string().optional(),
})

const failure = (reason: SyncIssue, detail: string): SyncFailure => ({
  ok: false,
  reason,
  detail,
})

export function transportFailure(detail: string): SyncFailure {
  return failure('google_error', `Could not reach Google: ${detail}`)
}

export function statusFailure(status: number, doing: string): SyncFailure {
  if (status === 401)
    return failure(
      'reauth_required',
      'Google rejected the connection. Reconnect it in Settings.',
    )
  if (status === 403)
    return failure(
      'missing_scope',
      `Google refused ${doing} for lack of calendar permission.`,
    )
  if (status === 429)
    return failure(
      'rate_limited',
      'Google is rate limiting us. Try again in a minute.',
    )
  return failure('google_error', `Google returned ${status} ${doing}.`)
}

async function send(
  url: string,
  init: RequestInit,
): Promise<{ ok: true; response: Response } | { ok: false; detail: string }> {
  try {
    return { ok: true, response: await fetch(url, init) }
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function clerkRefusal(status: number): SyncFailure | null {
  if (status === 401 || status === 403)
    return failure(
      'not_configured',
      `Clerk rejected this deployment's API key with ${status}. CLERK_SECRET_KEY is wrong or lacks permission. The user cannot fix this.`,
    )
  if (status === 429)
    return failure(
      'rate_limited',
      'Clerk is rate limiting us. Try again in a minute.',
    )
  if (status >= 500)
    return failure(
      'google_error',
      `Clerk returned ${status} while fetching the Google token.`,
    )
  return null
}

async function googleAccess(
  clerkUserId: string,
): Promise<{ ok: true; token: string; scopes: Array<string> } | SyncFailure> {
  const secret = process.env.CLERK_SECRET_KEY
  if (!secret)
    return failure(
      'not_configured',
      'CLERK_SECRET_KEY is not set on the Convex deployment. Run: npx convex env set CLERK_SECRET_KEY sk_...',
    )

  for (const provider of ['google', 'oauth_google']) {
    const attempt = await send(
      `https://api.clerk.com/v1/users/${clerkUserId}/oauth_access_tokens/${provider}`,
      { headers: { Authorization: `Bearer ${secret}` } },
    )
    if (!attempt.ok) continue
    const refused = clerkRefusal(attempt.response.status)
    if (refused) return refused
    if (!attempt.response.ok) continue
    const parsed = clerkTokenBody.safeParse(await readJson(attempt.response))
    if (!parsed.success) continue
    const entries = Array.isArray(parsed.data)
      ? parsed.data
      : (parsed.data.data ?? [])
    const entry = entries.find((candidate) => candidate.token !== undefined)
    if (!entry?.token) continue
    const expirySeconds = entry.expires_at ?? entry.expiration
    if (expirySeconds !== undefined && expirySeconds * 1000 <= Date.now())
      return failure(
        'reauth_required',
        'The Google connection has expired. Reconnect it in Settings.',
      )
    return { ok: true, token: entry.token, scopes: entry.scopes ?? [] }
  }

  return failure(
    'not_connected',
    'No Google account is connected to this Clerk user.',
  )
}

function listUrl(from: number, to: number, pageToken?: string): string {
  const params = new URLSearchParams({
    timeMin: new Date(from).toISOString(),
    timeMax: new Date(to).toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    showDeleted: 'false',
    maxResults: String(PAGE_SIZE),
    ...(pageToken ? { pageToken } : {}),
  })
  return `${EVENTS_URL}?${params.toString()}`
}

function calendarFor(token: string): GoogleCalendar {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }

  const written = async (response: Response) => {
    const parsed = writtenEvent.safeParse(await readJson(response))
    return parsed.success ? parsed.data : {}
  }
  const saved = (event: z.infer<typeof writtenEvent>): Saved => ({
    kind: 'saved',
    id: event.id ?? null,
    link: event.htmlLink ?? null,
  })

  return {
    insert: async (eventId, body) => {
      const sent = await send(EVENTS_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, id: eventId }),
      })
      if (!sent.ok)
        return { kind: 'failed', failure: transportFailure(sent.detail) }
      if (sent.response.status === 409) return { kind: 'conflict' }
      if (!sent.response.ok)
        return {
          kind: 'failed',
          failure: statusFailure(sent.response.status, 'creating the event'),
        }
      return saved(await written(sent.response))
    },

    patch: async (eventId, body) => {
      const sent = await send(`${EVENTS_URL}/${eventId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      })
      if (!sent.ok)
        return { kind: 'failed', failure: transportFailure(sent.detail) }
      const { status } = sent.response
      if (status === 404 || status === 410) return { kind: 'gone' }
      if (!sent.response.ok)
        return {
          kind: 'failed',
          failure: statusFailure(status, 'writing the event'),
        }
      const event = await written(sent.response)
      return event.status === 'cancelled' ? { kind: 'gone' } : saved(event)
    },

    remove: async (eventId) => {
      const sent = await send(`${EVENTS_URL}/${eventId}`, {
        method: 'DELETE',
        headers,
      })
      if (!sent.ok)
        return { kind: 'failed', failure: transportFailure(sent.detail) }
      const { status } = sent.response
      if (sent.response.ok || status === 404 || status === 410)
        return { kind: 'removed' }
      return {
        kind: 'failed',
        failure: statusFailure(status, 'deleting the event'),
      }
    },

    list: async (from, to) => {
      const items: Array<unknown> = []
      let pageToken: string | undefined
      for (let page = 0; page < MAX_PAGES; page++) {
        const sent = await send(listUrl(from, to, pageToken), { headers })
        if (!sent.ok)
          return transportFailure(`reading the calendar: ${sent.detail}`)
        if (!sent.response.ok)
          return statusFailure(sent.response.status, 'reading your calendar')
        const parsed = eventPage.safeParse(await readJson(sent.response))
        if (!parsed.success)
          return failure(
            'google_error',
            'Google sent a response Life OS could not read.',
          )
        items.push(...(parsed.data.items ?? []))
        if (!parsed.data.nextPageToken) break
        pageToken = parsed.data.nextPageToken
      }
      return { ok: true, items }
    },
  }
}

export async function openGoogleCalendar(
  clerkUserId: string,
): Promise<{ ok: true; calendar: GoogleCalendar } | SyncFailure> {
  const access = await googleAccess(clerkUserId)
  if (!access.ok) return access
  if (!access.scopes.includes(GOOGLE_EVENTS_SCOPE))
    return failure(
      'missing_scope',
      `The connected Google account has not granted ${GOOGLE_EVENTS_SCOPE}.`,
    )
  return { ok: true, calendar: calendarFor(access.token) }
}
