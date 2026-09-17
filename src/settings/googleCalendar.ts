import { useEffect } from 'react'
import { useUser } from '@clerk/tanstack-react-start'
import { useAction } from 'convex/react'
import { useQuery } from '@tanstack/react-query'

import { api } from '../../convex/_generated/api'
import {
  calendarSettingsQueryOptions,
  useUpdateCalendarSettings,
} from './queries'

/**
 * The client half of the calendar integration. Two jobs, and deliberately not
 * a third: it reports whether Google is connected, and it starts the connect
 * flow. It never touches a Google access token — that lives entirely in the
 * Convex action (see `convex/calendar.ts`).
 */

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events'

/** Clerk's resource types don't resolve through this package's export map, so
 *  the two shapes we actually read are declared here. Narrow on purpose: if
 *  Clerk changes, this breaks loudly at one place rather than everywhere. */
type ExternalAccount = {
  provider?: string
  approvedScopes?: string
  reauthorize?: (opts: {
    additionalScopes: Array<string>
    redirectUrl: string
  }) => Promise<{
    verification?: { externalVerificationRedirectURL?: URL | null }
  }>
}

type ClerkUser = {
  externalAccounts?: Array<ExternalAccount>
  createExternalAccount?: (opts: {
    strategy: string
    additionalScopes: Array<string>
    redirectUrl: string
  }) => Promise<{
    verification?: { externalVerificationRedirectURL?: URL | null }
  }>
}

export type CalendarConnection =
  /** No Google account on this Clerk user. */
  | { status: 'disconnected' }
  /** Google is linked but calendar access was never granted. */
  | { status: 'needs_scope' }
  | { status: 'connected' }
  | { status: 'loading' }

/**
 * Connection state read from Clerk, which is the only place that knows.
 *
 * The previous version stored a `googleConnected` boolean that the app set
 * itself, including in the OAuth *failure* path — so a user who cancelled the
 * Google prompt was recorded as connected, and every later sync attempt failed
 * silently against a permission they never gave.
 */
export function useGoogleCalendar() {
  const { user, isLoaded } = useUser()

  const connection: CalendarConnection = (() => {
    if (!isLoaded) return { status: 'loading' }
    const accounts = (user as ClerkUser | null | undefined)?.externalAccounts
    const google = accounts?.find((a) => a.provider?.includes('google'))
    if (!google) return { status: 'disconnected' }
    return google.approvedScopes?.includes(CALENDAR_SCOPE)
      ? { status: 'connected' }
      : { status: 'needs_scope' }
  })()

  /**
   * No consent URL back from Clerk is a real failure and is reported as one.
   * The old code caught that case and recorded "connected" anyway, which is
   * how users ended up syncing against a permission they never granted.
   */
  const connect = async () => {
    const clerkUser = user as ClerkUser | null | undefined
    if (!clerkUser) throw new Error('Not signed in')
    const redirectUrl = window.location.href
    const google = clerkUser.externalAccounts?.find((a) =>
      a.provider?.includes('google'),
    )

    const result = google?.reauthorize
      ? await google.reauthorize({
          additionalScopes: [CALENDAR_SCOPE],
          redirectUrl,
        })
      : await clerkUser.createExternalAccount?.({
          strategy: 'oauth_google',
          additionalScopes: [CALENDAR_SCOPE],
          redirectUrl,
        })

    const next = result?.verification?.externalVerificationRedirectURL
    if (!next) {
      throw new Error(
        'Clerk did not return a Google consent URL. Check that Google SSO is enabled for this instance.',
      )
    }
    window.location.href = next.toString()
  }

  return { connection, connect }
}

/* ------------------------------------------------------------------- sync */

/** Kept beside the action's result type so a new failure case shows up as a
 *  missing key here rather than as a silent fallthrough. */
const MESSAGES: Record<string, string> = {
  created: 'Added to Google Calendar',
  updated: 'Updated in Google Calendar',
  deleted: 'Removed from Google Calendar',
  event_removed: 'That event was removed in Google Calendar',
  not_connected: 'Connect Google Calendar in Settings first',
  reauth_required: 'Google Calendar needs reconnecting',
  missing_scope:
    'Life OS needs calendar permission. Reconnect Google in Settings.',
  no_timezone: 'Life OS does not know your timezone yet',
  not_personal: 'Calendar sync is personal only',
  not_configured: 'Calendar sync is not configured on the server',
  rate_limited: 'Google is rate limiting us. Try again shortly.',
  google_error: 'Google rejected the change',
}

/** The reasons whose fix is a reconnect, so a caller can offer the action
 *  rather than only show a message. */
const RECONNECT_REASONS = new Set([
  'not_connected',
  'reauth_required',
  'missing_scope',
  'not_configured',
])

export type SyncOutcome =
  | { ok: true; silent: boolean; message: string; link: string | null }
  | { ok: false; message: string; detail: string; needsReconnect: boolean }

/**
 * Callers pass a task id and get back a message. They never learn that Google
 * exists, that there is a token, or that a create and an update differ.
 */
export function useSyncTaskToCalendar() {
  const syncTask = useAction(api.calendar.syncTask)

  // Promise-chain style, not async/await with try/catch: a try/catch with
  // value blocks opts the hook out of React Compiler memoization.
  return (taskId: string): Promise<SyncOutcome> =>
    syncTask({ taskId }).then(
      (result): SyncOutcome =>
        result.ok
          ? {
              ok: true,
              silent: result.action === 'noop',
              message: MESSAGES[result.action] ?? 'Calendar updated',
              link: result.link,
            }
          : {
              ok: false,
              message: MESSAGES[result.reason] ?? 'Calendar sync failed',
              detail: result.detail,
              needsReconnect: RECONNECT_REASONS.has(result.reason),
            },
      (error: unknown): SyncOutcome => ({
        ok: false,
        message: 'Calendar sync failed',
        detail: error instanceof Error ? error.message : String(error),
        needsReconnect: false,
      }),
    )
}

/* ---------------------------------------------------------------- timezone */

/**
 * Google reads an offset-bearing timestamp as a fixed instant, so the only way
 * to keep a 09:00 task at 09:00 is to tell it the zone the wall clock was
 * captured in. The browser knows it; the server cannot. This writes it once.
 *
 * Mounted from behind the calendar flag, so a build without the feature never
 * touches the settings query.
 */
export function useEnsureTimezone() {
  const { data: settings } = useQuery(calendarSettingsQueryOptions)
  const update = useUpdateCalendarSettings()
  const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone

  useEffect(() => {
    if (!resolved || settings === undefined) return
    if (settings.timeZone === resolved) return
    update.mutate({ timeZone: resolved })
  }, [resolved, settings, update])
}
