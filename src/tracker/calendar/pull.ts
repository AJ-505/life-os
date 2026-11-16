import { useEffect, useRef, useState } from 'react'
import { useAction } from 'convex/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { toast } from 'sonner'
import * as z from 'zod'

import { api } from '../../../convex/_generated/api'
import { boardQueryOptions } from '../queries'
import { withTasksIn } from '../board/board-logic'
import { useBoardScope } from '../board-scope'
import { useGoogleCalendar } from '#/settings/googleCalendar'

import type { BoardData, Task } from '../types'
import type { ExternalEvent } from './calendar-logic'
import type { FunctionReturnType } from 'convex/server'

const externalEventsQuery = (from: number, to: number) =>
  convexQuery(api.calendarPull.listExternalEvents, { from, to })

const PULL_WINDOW_PAD_MS = 7 * 86_400_000
const PULL_MAX_AGE_MS = 5 * 60_000
const PULL_NAV_GAP_MS = 10_000

const lastPull = z.object({ at: z.number(), from: z.number(), to: z.number() })
type LastPull = z.infer<typeof lastPull>

const LAST_PULL_KEY = 'lifeos.calendar.pullBack'

function readLastPull(): LastPull | null {
  try {
    const raw = localStorage.getItem(LAST_PULL_KEY)
    if (!raw) return null
    const parsed = lastPull.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function lastPulledAt(): number | null {
  return readLastPull()?.at ?? null
}

function writeLastPull(entry: LastPull) {
  try {
    localStorage.setItem(LAST_PULL_KEY, JSON.stringify(entry))
  } catch {}
}

type PullFailure = Extract<
  FunctionReturnType<typeof api.calendarPull.pullExternalEvents>,
  { ok: false }
>

const PULL_MESSAGES: Record<PullFailure['reason'], string> = {
  not_connected: 'Connect Google Calendar in Settings first',
  reauth_required: 'Google Calendar needs reconnecting',
  missing_scope:
    'Life OS needs calendar permission. Reconnect Google in Settings.',
  no_timezone: 'Life OS does not know your timezone yet',
  not_configured: 'Calendar sync is not configured on the server',
  not_personal: 'Calendar sync is personal only',
  event_removed: 'That event is gone from your calendar',
  rate_limited: 'Google is rate limiting us. Try again shortly.',
  google_error: 'Could not read your calendar',
}

export function useBackwardSync(days: Array<Date>, active: boolean) {
  const spaceId = useBoardScope()
  const personal = spaceId === null
  const { connection } = useGoogleCalendar()
  const connected = connection.status === 'connected'
  const pull = useAction(api.calendarPull.pullExternalEvents)
  const [lastPullEntry, setLastPullEntry] = useState<LastPull | null>(
    readLastPull,
  )
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
    const entry = lastPullEntry
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
    const stamp: LastPull = { at: Date.now(), from, to }
    writeLastPull(stamp)
    setLastPullEntry(stamp)
    running.current = true
    pull({ from, to }).then(
      (result) => {
        running.current = false
        if (!result.ok)
          toast.error(PULL_MESSAGES[result.reason], {
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

  const events = (query.data ?? []) as Array<ExternalEvent>
  return { events, lastPulled: lastPullEntry?.at ?? null }
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

export function importedTask(
  event: ExternalEvent,
  vars: { taskId: string; projectId: string; position: number },
): Task {
  return {
    id: vars.taskId,
    projectId: vars.projectId,
    parentId: null,
    title: event.title,
    notes: event.notes,
    position: vars.position,
    done: false,
    doneAt: null,
    archived: false,
    dueAt: event.start,
    reminderMinutes: null,
    durationMinutes: event.allDay
      ? null
      : clampTaskDuration((event.end - event.start) / 60_000),
    repeat: null,
    addToCalendar: false,
    calendarEventId: null,
    calendarSyncIssue: null,
    importedFromEventId: event.eventId,
    inFocus: false,
    focusOrder: 0,
    createdAt: Date.now(),
    assigneeId: null,
    spaceId: null,
  }
}

const clampTaskDuration = (minutes: number) =>
  Number.isFinite(minutes)
    ? Math.max(5, Math.min(24 * 60, Math.round(minutes)))
    : null

type ImportVars = {
  event: ExternalEvent
  taskId: string
  projectId: string
  position: number
}

export function useImportExternalEvent() {
  const spaceId = useBoardScope()
  const importEvent = useConvexMutation(api.calendarPull.importEvent)
  const queryClient = useQueryClient()

  return useMutation<null, Error, ImportVars, { board: BoardData } | undefined>(
    {
      mutationFn: (vars) =>
        importEvent({
          eventId: vars.event.eventId,
          taskId: vars.taskId,
          projectId: vars.projectId,
          position: vars.position,
        }),
      onMutate: (vars) => {
        if (spaceId !== null) return
        const options = boardQueryOptions(null)
        const board = queryClient.getQueryData<BoardData>(options.queryKey)
        if (!board) return
        const task = importedTask(vars.event, vars)
        queryClient.setQueryData<BoardData>(
          options.queryKey,
          withTasksIn(board, vars.projectId, null, [task]),
        )
        return { board }
      },
      onError: (error, _vars, context) => {
        if (context) {
          queryClient.setQueryData<BoardData>(
            boardQueryOptions(null).queryKey,
            context.board,
          )
        }
        toast.error('Could not add that event as a task', {
          description: error instanceof Error ? error.message : String(error),
        })
      },
    },
  )
}
