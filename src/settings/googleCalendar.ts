import { useEffect } from 'react'
import { useUser } from '@clerk/tanstack-react-start'
import { useAction } from 'convex/react'
import { useQuery } from '@tanstack/react-query'

import { api } from '../../convex/_generated/api'
import {
  calendarSettingsQueryOptions,
  useUpdateCalendarSettings,
} from './queries'

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events'

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
  | { status: 'disconnected' }
  | { status: 'needs_scope' }
  | { status: 'connected' }
  | { status: 'loading' }

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

type SyncMessage = Record<SyncAction | SyncReason, string>

type SyncResultShape = Awaited<
  ReturnType<ReturnType<typeof useAction<typeof api.calendar.syncTask>>>
>
type SyncAction = Extract<SyncResultShape, { ok: true }>['action']
type SyncReason = Extract<SyncResultShape, { ok: false }>['reason']

const MESSAGES: SyncMessage = {
  created: 'Added to Google Calendar',
  updated: 'Updated in Google Calendar',
  deleted: 'Removed from Google Calendar',
  noop: 'Calendar updated',
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

const RECONNECT_REASONS: Set<SyncReason> = new Set([
  'not_connected',
  'reauth_required',
  'missing_scope',
])

export type SyncOutcome =
  | { ok: true; silent: boolean; message: string; link: string | null }
  | { ok: false; message: string; detail: string; needsReconnect: boolean }

export function useSyncTaskToCalendar() {
  const syncTask = useAction(api.calendar.syncTask)

  return (taskId: string): Promise<SyncOutcome> =>
    syncTask({ taskId }).then(
      (result): SyncOutcome =>
        result.ok
          ? {
              ok: true,
              silent: result.action === 'noop',
              message: MESSAGES[result.action],
              link: result.link,
            }
          : {
              ok: false,
              message: MESSAGES[result.reason],
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
