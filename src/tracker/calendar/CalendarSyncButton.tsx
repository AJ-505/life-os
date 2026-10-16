import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CalendarCheck, CalendarSync } from 'lucide-react'

import { CALENDAR_ENABLED } from '#/feature-flags'
import { Button } from '#/design-system/ui/button'
import { Label } from '#/design-system/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/design-system/ui/popover'
import { Switch } from '#/design-system/ui/switch'
import { useGoogleCalendar } from '#/settings/googleCalendar'
import {
  calendarSettingsQueryOptions,
  useUpdateCalendarSettings,
} from '#/settings/queries'

import { useBoardScope } from '../board-scope'

export function CalendarSyncButton() {
  const spaceId = useBoardScope()
  if (!CALENDAR_ENABLED || spaceId !== null) return null
  return <CalendarSyncControl />
}

function CalendarSyncControl() {
  const { data: settings } = useQuery(calendarSettingsQueryOptions)
  const updateSettings = useUpdateCalendarSettings()
  const { connection, connect } = useGoogleCalendar()

  const connected = connection.status === 'connected'
  const syncing = settings?.syncEnabled ?? false
  const autoAdd = settings?.autoAddToCalendar ?? false
  const done = connected && syncing && autoAdd
  const Icon = done ? CalendarCheck : CalendarSync

  const handleConnect = async () => {
    try {
      await connect()
    } catch (e) {
      toast.error('Could not connect Google Calendar', {
        description: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={done ? 'ghost' : 'outline'}
          size="sm"
          className="ml-auto h-7 shrink-0 gap-1.5 px-2"
          aria-label={done ? 'Synced to Google Calendar' : 'Sync to Google'}
        >
          <Icon className="size-4" />
          <span className="hidden sm:inline">
            {done ? 'Synced' : 'Sync to Google'}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Label className="text-sm font-medium">Google Calendar</Label>
          {connected ? (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="size-2 rounded-full bg-emerald-500" />
              Connected
            </span>
          ) : (
            <>
              <span className="text-xs leading-snug text-muted-foreground">
                {connection.status === 'needs_scope'
                  ? 'Your Google account is linked but has not granted calendar access.'
                  : 'Connect your Google account to push tasks to your calendar.'}
              </span>
              <Button
                size="sm"
                disabled={connection.status === 'loading'}
                onClick={handleConnect}
              >
                {connection.status === 'needs_scope'
                  ? 'Grant calendar access'
                  : 'Connect Google Calendar'}
              </Button>
            </>
          )}
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label className="text-sm font-medium">Sync tasks</Label>
          <Switch
            checked={syncing}
            disabled={!connected}
            onCheckedChange={(checked) =>
              updateSettings.mutate({ syncEnabled: checked })
            }
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <Label className="text-sm font-medium">Add every dated task</Label>
            <span className="text-xs text-muted-foreground">
              No need to switch on each task
            </span>
          </div>
          <Switch
            checked={autoAdd}
            disabled={!connected || !syncing}
            onCheckedChange={(checked) =>
              updateSettings.mutate({ autoAddToCalendar: checked })
            }
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
