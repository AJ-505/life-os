import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '#/design-system/ui/button'
import { Label } from '#/design-system/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/design-system/ui/select'
import { Separator } from '#/design-system/ui/separator'
import { Switch } from '#/design-system/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/design-system/ui/tooltip'
import { boardQueryOptions } from '#/tracker/queries'
import { REMINDER_CHOICES, eventsToDelete } from '../../convex/syncRule'
import { useCalendarSync, useRepairCalendar } from './calendar-sync'
import { useUpdateCalendarSettings } from './queries'

export function CalendarSettings() {
  const sync = useCalendarSync()
  const { data: board } = useQuery(boardQueryOptions(null))
  const updateSettings = useUpdateCalendarSettings()
  const { repair, running } = useRepairCalendar()
  const [repairHint, setRepairHint] = useState(false)
  const [confirmOff, setConfirmOff] = useState(false)

  const enabled = sync.rule.syncEnabled
  const needsScope = sync.connection.status === 'needs_scope'
  const syncedEvents = eventsToDelete(
    (board ?? []).flatMap((project) => project.tasks),
  ).length

  const handleToggle = (checked: boolean) => {
    if (!checked) {
      setConfirmOff(true)
      return
    }
    updateSettings.mutate({ syncEnabled: true })
  }

  const handleDisconnect = () => {
    updateSettings.mutate({ syncEnabled: false })
    setConfirmOff(false)
    toast.success('Calendar sync turned off')
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">Calendar Integration</h3>
      <Separator />

      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <Label className="text-sm font-medium">
            Enable Google Calendar Sync
          </Label>
          {!enabled ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              Connect your Google Calendar to sync task times
            </span>
          ) : null}
        </div>
        <Switch checked={enabled} onCheckedChange={handleToggle} />
      </div>

      {confirmOff ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p className="mb-2 text-xs leading-snug">
            Turning sync off removes {syncedEvents} synced{' '}
            {syncedEvents === 1 ? 'event' : 'events'} from your Google Calendar.
            Events you deleted there are unaffected.
          </p>
          <div className="flex gap-1.5">
            <Button size="sm" variant="destructive" onClick={handleDisconnect}>
              Turn off and remove events
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmOff(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {enabled && !sync.connected ? (
        <div className="rounded-md border border-dashed p-3">
          <p className="mb-2 text-xs leading-snug text-muted-foreground">
            {needsScope
              ? 'Your Google account is linked but has not granted calendar access yet.'
              : 'Connect your Google account to push task times to your calendar.'}
          </p>
          <Button size="sm" className="w-full" onClick={sync.connect}>
            {needsScope ? 'Grant calendar access' : 'Connect Google Calendar'}
          </Button>
        </div>
      ) : null}

      {enabled && sync.connected ? (
        <div className="flex items-center justify-between rounded-md border bg-accent/30 px-3 py-2">
          <span className="flex items-center gap-2 text-sm">
            <span className="size-2 rounded-full bg-emerald-500" />
            Connected
          </span>
          <Button variant="ghost" size="sm" onClick={() => handleToggle(false)}>
            Turn off sync
          </Button>
        </div>
      ) : null}

      {enabled ? (
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <Label className="text-sm font-medium">Add every dated task</Label>
            <span className="font-mono text-[11px] text-muted-foreground">
              Every personal task with a date goes to your calendar
            </span>
          </div>
          <Switch
            checked={sync.rule.autoAdd}
            onCheckedChange={(checked) =>
              updateSettings.mutate({ autoAddToCalendar: checked })
            }
          />
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <Label className="os-label">Default reminder</Label>
        <Select
          value={String(sync.defaultReminder)}
          onValueChange={(value) =>
            updateSettings.mutate({ defaultReminderMinutes: Number(value) })
          }
        >
          <SelectTrigger size="sm" className="w-[140px] text-xs">
            <SelectValue>{`${sync.defaultReminder} minutes before`}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {REMINDER_CHOICES.map((minutes) => (
              <SelectItem key={minutes} value={String(minutes)}>
                {minutes} minutes before
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <Label className="os-label">Repair calendar</Label>
        <Tooltip open={repairHint} onOpenChange={setRepairHint}>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className="rounded-md"
              onPointerDown={(e) => {
                if (e.pointerType === 'touch') setRepairHint(!repairHint)
              }}
            >
              <Button
                size="sm"
                variant="outline"
                disabled={!enabled || !sync.connected || running}
                onClick={() => void repair()}
              >
                {running ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Repair now
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" align="end" className="max-w-56">
            Missing or out-of-date events? This sends every synced task to
            Google again and brings back events you deleted there.
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
