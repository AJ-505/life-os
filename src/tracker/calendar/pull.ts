import { useEffect, useRef, useState } from 'react'
import { useAction } from 'convex/react'
import { useQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { toast } from 'sonner'
import * as z from 'zod'

import { api } from '../../../convex/_generated/api'
import { jsonCodec, storedValue, useStored } from '#/design-system'
import { useGoogleCalendar } from '#/settings/googleCalendar'
import { SYNC_ISSUE_MESSAGES } from '#/settings/calendar-sync'
import { useBoardScope } from '../board-scope'

const externalEventsQuery = (from: number, to: number) =>
  convexQuery(api.calendarPull.listExternalEvents, { from, to })

const PULL_WINDOW_PAD_MS = 7 * 86_400_000
const PULL_MAX_AGE_MS = 5 * 60_000
const PULL_NAV_GAP_MS = 10_000

const lastPull = storedValue(
  'lifeos.calendar.pullBack',
  jsonCodec(
    z.object({ at: z.number(), from: z.number(), to: z.number() }).nullable(),
  ),
  null,
)

export function useLastPulledAt(): number | null {
  return useStored(lastPull)[0]?.at ?? null
}

export function useBackwardSync(days: Array<Date>, active: boolean) {
  const personal = useBoardScope().can.importEvents
  const { connection } = useGoogleCalendar()
  const connected = connection.status === 'connected'
  const pull = useAction(api.calendarPull.pullExternalEvents)
  const [lastPullEntry] = useStored(lastPull)
  const [gateTick, setGateTick] = useState(0)
  const running = useRef(false)

  const first = days.at(0)
  const last = days.at(-1)
  const from = first && last ? startOfDayMs(first) - PULL_WINDOW_PAD_MS : 0
  const to = first && last ? endOfDayMs(last) + PULL_WINDOW_PAD_MS : 0

  const query = useQuery({
    ...externalEventsQuery(from, to),
    enabled: personal && days.length > 0 && !!first && !!last,
  })

  useEffect(() => {
    if (!active || !connected || !personal) return
    if (!first || !last) return
    const entry = lastPull.read()
    const age = entry ? Date.now() - entry.at : Number.POSITIVE_INFINITY
    const covered = entry ? entry.from <= from && entry.to >= to : false
    const gate = covered ? PULL_MAX_AGE_MS : PULL_NAV_GAP_MS
    if (age < gate) {
      if (Number.isFinite(age)) {
        const timer = window.setTimeout(
          () => setGateTick((tick) => tick + 1),
          gate - age,
        )
        return () => window.clearTimeout(timer)
      }
      return
    }
    if (running.current) return
    lastPull.write({ at: Date.now(), from, to })
    running.current = true
    pull({ from, to }).then(
      (result) => {
        running.current = false
        if (!result.ok)
          toast.error(SYNC_ISSUE_MESSAGES[result.reason], {
            description: result.detail,
          })
        setGateTick((tick) => tick + 1)
      },
      (error: unknown) => {
        running.current = false
        toast.error('Could not read your calendar', {
          description: error instanceof Error ? error.message : String(error),
        })
        setGateTick((tick) => tick + 1)
      },
    )
  }, [
    active,
    connected,
    personal,
    from,
    to,
    first,
    last,
    lastPullEntry,
    gateTick,
    pull,
  ])

  return { events: query.data ?? [], lastPulled: lastPullEntry?.at ?? null }
}

function startOfDayMs(day: Date): number {
  const copy = new Date(day)
  copy.setHours(0, 0, 0, 0)
  return copy.getTime()
}

function endOfDayMs(day: Date): number {
  const copy = new Date(day)
  copy.setHours(23, 59, 59, 999)
  return copy.getTime()
}
