import { useEffect } from 'react'
import { useAuth, useUser } from '@clerk/tanstack-react-start'
import { useMutation } from 'convex/react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import * as z from 'zod'

import { api } from '../../convex/_generated/api'
import { GOOGLE_EVENTS_SCOPE } from '../../convex/syncRule'
import { localTimeZone } from '../../convex/zonedTime'
import { storedValue, textCodec } from '#/design-system'
import {
  calendarSettingsQueryOptions,
  useUpdateCalendarSettings,
} from './queries'

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
    return google.approvedScopes?.includes(GOOGLE_EVENTS_SCOPE)
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
          additionalScopes: [GOOGLE_EVENTS_SCOPE],
          redirectUrl,
        })
      : await clerkUser.createExternalAccount?.({
          strategy: 'oauth_google',
          additionalScopes: [GOOGLE_EVENTS_SCOPE],
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

const restoredInSession = storedValue(
  'lifeos.calendar.restoreSession',
  textCodec(z.string()),
  '',
)
const retriedInSession = storedValue(
  'lifeos.calendar.retrySession',
  textCodec(z.string()),
  '',
)

function firstTimeThisSession(
  store: typeof restoredInSession,
  sessionId: string,
): boolean {
  if (store.read() === sessionId) return false
  store.write(sessionId)
  return true
}

export function useRestoreCalendarAccess() {
  const { sessionId } = useAuth()
  const { connection, connect } = useGoogleCalendar()
  const { data: settings } = useQuery(calendarSettingsQueryOptions)
  const retryAccessIssues = useMutation(api.calendar.retryAccessIssues)
  const syncEnabled = settings?.syncEnabled ?? false
  const status = connection.status

  useEffect(() => {
    if (!sessionId || !syncEnabled) return
    if (
      status === 'connected' &&
      firstTimeThisSession(retriedInSession, sessionId)
    ) {
      void retryAccessIssues({})
      return
    }
    if (status !== 'needs_scope') return
    if (!firstTimeThisSession(restoredInSession, sessionId)) return
    const id = toast.loading('Restoring Google Calendar access…')
    connect().catch((error: unknown) => {
      toast.error('Could not restore Google Calendar access', {
        id,
        description: error instanceof Error ? error.message : String(error),
      })
    })
  }, [sessionId, syncEnabled, status, connect, retryAccessIssues])
}

export function useEnsureTimezone() {
  const { data: settings } = useQuery(calendarSettingsQueryOptions)
  const update = useUpdateCalendarSettings()
  const resolved = localTimeZone()

  useEffect(() => {
    if (settings === undefined) return
    if (settings.timeZone === resolved) return
    update.mutate({ timeZone: resolved })
  }, [resolved, settings, update])
}
