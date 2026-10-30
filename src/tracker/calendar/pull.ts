import { useEffect, useRef, useState } from 'react'
import { useAction } from 'convex/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { toast } from 'sonner'
import * as z from 'zod'

import { api } from '../../../convex/_generated/api'
import { boardQueryOptions } from '../queries'
import { useBoardScope } from '../board-scope'
import { useGoogleCalendar } from '#/settings/googleCalendar'

import type { BoardData, Task } from '../types'
import type { ExternalEvent } from './calendar-logic'
import type { FunctionReturnType } from 'convex/server'

/**
 * The client half of backward calendar sync.
 *
 * While a personal calendar view is open this hook keeps a window of Google
 * events fresh: it subscribes to the cached slice, calls the pull action when
 * the window is not covered or has aged out, and lets the live Convex
 * subscription repaint the grid when the cache changes. Every failure is a
 * toast with a fix, never a silent blank grid — an absent overlay must not be
 * mistaken for an empty calendar.
 *
 * Import ("Add as task") runs as a mutation whose optimistic patch is built
 * here, not in `.withOptimisticUpdate`: the server derives the task from the
 * cached event row, so the args it validates cannot carry the display fields
 * the patch needs. The variables carry them instead, and rollback restores the
 * snapshot the patch started from.
 */

const externalEventsQuery = (from: number, to: number) =>
  convexQuery(api.calendarPull.listExternalEvents, { from, to })

/** The user's own calendar is the only feed the cache holds, so the overlay is
 *  a personal-scope feature, exactly like push sync. */

/* --------------------------------------------------------------- freshness */

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

/** When the back-pull last ran, for the sync control's status line. Read at
 *  render time from localStorage: the popover remounts when opened, which is
 *  fresh enough for "a minute ago". */
export function lastPulledAt(): number | null {
  return readLastPull()?.at ?? null
}

function writeLastPull(entry: LastPull) {
  try {
    localStorage.setItem(LAST_PULL_KEY, JSON.stringify(entry))
  } catch {
    // A dead localStorage costs at most one extra pull per activation.
  }
}

/** Keys come from the wire type, so a new server reason cannot ship without
 *  copy to show for it. Two failures are push-only (an event Life OS no longer
 *  owns can never be pulled), but keeping the map exhaustive is the price of
 *  the guarantee. */
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
  // Bumped whenever an in-flight pull ends or a throttle timer elapses, so the
  // gate re-evaluates against the window the view is showing *now*. Without
  // it, a click that lands while a pull is mid-flight would never pull: the
  // effect's other deps did not change, and no render was scheduled.
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
    // Coverage is what matters: a window the last pull did not span has never
    // been fetched, however recent that pull was. Covered windows refresh on
    // the age gate, which also acts as the periodic refresh while open.
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
    // Stamped before the run so a slow pull cannot queue itself behind every
    // render; a failure only delays the next attempt to the next gate.
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

/* ------------------------------------------------------------------- import */

/**
 * The task fields an import will land with, computed once on the client: the
 * optimistic patch and the awaited result must render the same thing, because
 * the server will build exactly this from the cached event row.
 */
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

/** Mirror of the server clamp: 5 to 24 hours, whole minutes. */
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

/**
 * Copy an external event onto the personal board as a task.
 *
 * Convex cannot validate the display fields the optimistic patch needs — the
 * server derives them from the cached event row, so they are not mutation
 * args — which is why this is a plain background mutation with a hand-rolled
 * TanStack snapshot instead of `.withOptimisticUpdate`. On error the snapshot
 * is restored; on success the live Convex subscription reconciles the patch
 * against server truth on its own.
 */
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
          board.map((project) =>
            project.id === vars.projectId
              ? { ...project, tasks: [...project.tasks, task] }
              : project,
          ),
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
