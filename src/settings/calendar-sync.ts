import { useState } from 'react'
import { useAction } from 'convex/react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api } from '../../convex/_generated/api'
import { DEFAULT_REMINDER_MINUTES, taskWantsEvent } from '../../convex/syncRule'
import { calendarSettingsQueryOptions } from './queries'
import { useGoogleCalendar } from './googleCalendar'

import type { SyncFields } from '../../convex/syncRule'
import type { SyncIssue } from '../../convex/taskModel'

export const SYNC_ISSUE_MESSAGES: Record<SyncIssue, string> = {
  event_removed: 'That event was removed in Google Calendar',
  not_connected: 'Connect Google Calendar in Settings first',
  reauth_required: 'Google Calendar needs reconnecting',
  missing_scope:
    'Life OS needs calendar permission. Reconnect Google in Settings.',
  no_timezone: 'Life OS does not know your timezone yet',
  not_personal: 'Calendar sync is personal only',
  not_configured: 'Calendar sync is not configured on the server',
  rate_limited: 'Google is rate limiting us. Try again shortly.',
  google_error: 'Google Calendar returned an error',
}

const RECONNECT_ISSUES: ReadonlyArray<SyncIssue> = [
  'not_connected',
  'reauth_required',
  'missing_scope',
]

export function syncIssueNote(issue: SyncIssue): string {
  return issue === 'event_removed'
    ? 'This event was deleted in Google Calendar. Use Repair calendar in Settings to bring it back.'
    : `Last sync with Google failed: ${SYNC_ISSUE_MESSAGES[issue]}`
}

export function useCalendarSync() {
  const { data: settings } = useQuery(calendarSettingsQueryOptions)
  const { connection, connect } = useGoogleCalendar()
  const rule = {
    syncEnabled: settings?.syncEnabled ?? false,
    autoAdd: settings?.autoAddToCalendar ?? false,
  }
  const connected = connection.status === 'connected'
  const connectOrWarn = () => {
    connect().catch((error: unknown) => {
      toast.error('Could not connect Google Calendar', {
        description: error instanceof Error ? error.message : String(error),
      })
    })
  }
  return {
    rule,
    connection,
    connect: connectOrWarn,
    connected,
    ready: connected && rule.syncEnabled,
    defaultReminder:
      settings?.defaultReminderMinutes ?? DEFAULT_REMINDER_MINUTES,
  }
}

export type CalendarSync = ReturnType<typeof useCalendarSync>

export type CalendarSwitch = {
  checked: boolean
  disabled: boolean
  hint: string
  showsIssue: boolean
}

export function calendarSwitch(
  sync: CalendarSync,
  task: SyncFields,
): CalendarSwitch {
  const dated = task.dueAt !== null
  const imported = (task.importedFromEventId ?? null) !== null
  const autoAdded =
    sync.ready && taskWantsEvent({ ...task, addToCalendar: false }, sync.rule)
  const on = task.addToCalendar === true || autoAdded
  const hint = !sync.rule.syncEnabled
    ? 'Turn on calendar sync in Settings'
    : sync.connection.status === 'needs_scope'
      ? 'Reconnect Google to grant calendar access'
      : !sync.connected
        ? 'Connect Google in Settings'
        : imported
          ? 'Imported from Google Calendar'
          : !dated
            ? 'Set a date first'
            : autoAdded
              ? 'Every dated task syncs (Settings)'
              : ''
  return {
    checked: dated && !imported && on,
    disabled: !dated || !sync.ready || autoAdded || imported,
    hint,
    showsIssue: on && !imported,
  }
}

export function useRepairCalendar() {
  const repairCalendar = useAction(api.calendar.repairCalendar)
  const [running, setRunning] = useState(false)

  const repair = async () => {
    if (running) return
    setRunning(true)
    try {
      const summary = await repairCalendar({})
      const tasks = `of ${summary.total} synced ${summary.total === 1 ? 'task' : 'tasks'}`
      if (summary.failed === 0) {
        toast.success(`Calendar repaired: ${summary.updated} updated ${tasks}`)
        return
      }
      const reason = summary.reason
      toast.error(
        `Calendar repair finished: ${summary.updated} updated, ${summary.failed} failed ${tasks}`,
        {
          description: reason
            ? `${SYNC_ISSUE_MESSAGES[reason]}${RECONNECT_ISSUES.includes(reason) ? ' Reconnect Google above.' : ''}`
            : undefined,
        },
      )
    } catch (error) {
      toast.error('Calendar repair failed', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setRunning(false)
    }
  }

  return { repair, running }
}
