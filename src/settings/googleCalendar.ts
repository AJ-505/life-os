import { useCallback, useMemo } from 'react'
import { useUser } from '@clerk/tanstack-react-start'
import { useAction } from 'convex/react'

import { api } from '../../convex/_generated/api'

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
  }) => Promise<{ verification?: { externalVerificationRedirectURL?: URL | null } }>
}

type ClerkUser = {
  externalAccounts?: Array<ExternalAccount>
  createExternalAccount?: (opts: {
    strategy: string
    additionalScopes: Array<string>
    redirectUrl: string
  }) => Promise<{ verification?: { externalVerificationRedirectURL?: URL | null } }>
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

  const connection: CalendarConnection = useMemo(() => {
    if (!isLoaded) return { status: 'loading' }
    const accounts = (user as ClerkUser | null | undefined)?.externalAccounts
    const google = accounts?.find((a) => a.provider?.includes('google'))
    if (!google) return { status: 'disconnected' }
    return google.approvedScopes?.includes(CALENDAR_SCOPE)
      ? { status: 'connected' }
      : { status: 'needs_scope' }
  }, [user, isLoaded])

  /**
   * No consent URL back from Clerk is a real failure and is reported as one.
   * The old code caught that case and recorded "connected" anyway, which is
   * how users ended up syncing against a permission they never granted.
   */
  const connect = useCallback(async () => {
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
  }, [user])

  return { connection, connect }
}

/* ------------------------------------------------------------------- sync */

/** Kept beside the action's result type so a new failure case shows up as a
 *  missing key here rather than as a silent fallthrough. */
const MESSAGES: Record<string, string> = {
  created: 'Added to Google Calendar',
  updated: 'Updated in Google Calendar',
  deleted: 'Removed from Google Calendar',
  not_connected: 'Connect Google Calendar in Settings first',
  missing_scope: 'Life OS needs calendar permission. Reconnect Google in Settings.',
  not_configured: 'Calendar sync is not configured on the server',
  google_error: 'Google rejected the change',
}

export type SyncOutcome =
  | { ok: true; silent: boolean; message: string; link: string | null }
  | { ok: false; message: string; detail: string }

/**
 * Callers pass a task id and get back a message. They never learn that Google
 * exists, that there is a token, or that a create and an update differ.
 */
export function useSyncTaskToCalendar() {
  const syncTask = useAction(api.calendar.syncTask)

  // Promise-chain style, not async/await with try/catch: a try/catch with
  // value blocks opts the hook out of React Compiler memoization.
  return useCallback(
    (taskId: string): Promise<SyncOutcome> =>
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
              },
        (error: unknown): SyncOutcome => ({
          ok: false,
          message: 'Calendar sync failed',
          detail: error instanceof Error ? error.message : String(error),
        }),
      ),
    [syncTask],
  )
}
