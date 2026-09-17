import { convexTest } from 'convex-test'
import { describe, expect, it, vi } from 'vitest'

import { eventIdsForTasks, derivedEventId, tryDerivedEventId } from './calendar'
import { api, internal } from './_generated/api'
import schema from './schema'

import type { TestConvex } from 'convex-test'

/**
 * The calendar lifecycle, at the level the UI cannot prove: what the server
 * sends to Google for a given task state, and what it does with Google's
 * answer.
 *
 * Google is stubbed at `fetch`, so the assertions are on the real request body
 * the action builds, including the wall clock. The clock is the part that used
 * to shift, and a same-timezone browser could never prove it.
 */

const modules = import.meta.glob([
  './**/*.ts',
  '!./**/*.test.ts',
  '!./test.setup.ts',
])

// The action reads the deployment's env, and convex-test hands each function the
// env of this module. Setting it here is what makes the Google half testable
// without a real Clerk deployment.
process.env.CLERK_SECRET_KEY = 'sk_test_calendar'

const SCOPE = 'https://www.googleapis.com/auth/calendar.events'

/** A real task id shape: Google's event-id alphabet is a subset of hex, so the
 *  derived id is only legal for ids of at least five allowed characters. */
const TASK_ID = '6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8'
const DERIVED = derivedEventId(TASK_ID)

type T = TestConvex<typeof schema>

type Call = { url: string; method: string; body: string | null }

/** Every fetch the action made, plus the reply each one got. */
function stubGoogle(options: {
  tokenExpirySeconds?: number
  scopes?: Array<string>
  createStatus?: number
  patchStatus?: number
  deleteStatus?: number
  patchCancelled?: boolean
  tokenStatus?: number
}) {
  const calls: Array<Call> = []
  const stub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input)
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? init.body : null
    calls.push({ url, method, body })

    if (url.includes('api.clerk.com')) {
      if (options.tokenStatus && options.tokenStatus !== 200)
        return new Response('{}', { status: options.tokenStatus })
      return Response.json([
        {
          token: 'google-access-token',
          scopes: options.scopes ?? [SCOPE],
          expires_at:
            options.tokenExpirySeconds ?? Math.floor(Date.now() / 1000) + 3600,
        },
      ])
    }

    if (method === 'DELETE')
      return new Response(null, { status: options.deleteStatus ?? 204 })
    if (method === 'PATCH') {
      if (options.patchStatus && options.patchStatus !== 200)
        return new Response('{}', { status: options.patchStatus })
      return Response.json({
        id: 'gcal-1',
        htmlLink: 'https://calendar.google.com/event?eid=gcal-1',
        status: options.patchCancelled ? 'cancelled' : 'confirmed',
      })
    }
    if (options.createStatus && options.createStatus !== 200)
      return new Response('{}', { status: options.createStatus })
    return Response.json({
      id: 'gcal-1',
      htmlLink: 'https://calendar.google.com/event?eid=gcal-1',
      status: 'confirmed',
    })
  }) as typeof fetch
  globalThis.fetch = stub
  return calls
}

async function seed(
  t: T,
  task: Partial<{
    dueAt: number | null
    addToCalendar: boolean
    calendarEventId: string | null
    done: boolean
    archived: boolean
    spaceId: string
  }> = {},
  settings: Partial<{
    syncEnabled: boolean
    timeZone: string | null
  }> = {},
) {
  await t.run(async (ctx) => {
    await ctx.db.insert('tasks', {
      userId: 'user_a',
      id: TASK_ID,
      projectId: 'p1',
      parentId: null,
      title: 'Ship the thing',
      notes: 'with notes',
      position: 1024,
      done: task.done ?? false,
      doneAt: null,
      archived: task.archived ?? false,
      dueAt: task.dueAt ?? null,
      reminderMinutes: null,
      addToCalendar: task.addToCalendar ?? false,
      calendarEventId: task.calendarEventId ?? null,
      inFocus: false,
      focusOrder: 0,
      createdAt: 1,
      ...(task.spaceId && { spaceId: task.spaceId }),
    })
    // The column is optional, so "no zone" is an absent field rather than a
    // null one. An explicit default here would erase the case under test.
    const zone =
      settings.timeZone === undefined ? 'Europe/Amsterdam' : settings.timeZone
    await ctx.db.insert('userSettings', {
      userId: 'user_a',
      calendarEnabled: settings.syncEnabled ?? true,
      calendarSyncEnabled: settings.syncEnabled ?? true,
      defaultReminderMinutes: 15,
      ...(zone !== null && { timeZone: zone }),
      createdAt: 1,
      updatedAt: 1,
    })
  })
}

function eventIdOf(call: Call | undefined): string | null {
  if (!call?.body) return null
  const parsed = JSON.parse(call.body) as { id?: string }
  return parsed.id ?? null
}

/**
 * Run what the mutation scheduled. Scheduled functions need the clock driven by
 * hand in convex-test, otherwise a `runAfter(0, ...)` never executes and the
 * assertion silently sees nothing.
 */
async function settleScheduled(t: T) {
  await t.finishInProgressScheduledFunctions()
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  vi.useRealTimers()
}

async function sync(t: T) {
  return await t.action(internal.calendar.syncTaskForUser, {
    userId: 'user_a',
    taskId: TASK_ID,
  })
}

describe('derivedEventId', () => {
  it('maps a uuid into Google id alphabet', () => {
    const id = derivedEventId(TASK_ID)
    expect(id).toBe('6f1a2b3c4d5e6f708192a3b4c5d6e7f8')
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/)
  })

  it('refuses an id it cannot map', () => {
    expect(() => derivedEventId('not a uuid!')).toThrow()
  })
})

describe('the decision matrix', () => {
  it('does nothing when the task neither wants nor has an event', async () => {
    const t = convexTest(schema, modules)
    await seed(t, { dueAt: 1_800_000_000_000 })
    const calls = stubGoogle({})
    const result = await sync(t)
    expect(result).toEqual({ ok: true, action: 'noop', link: null })
    expect(calls).toHaveLength(0)
  })

  it('creates with the derived id, the wall clock and the stored zone', async () => {
    const t = convexTest(schema, modules)
    await seed(t, { dueAt: 1_800_000_000_000, addToCalendar: true })
    const calls = stubGoogle({})
    const result = await sync(t)
    expect(result.ok).toBe(true)
    const post = calls.find((c) => c.method === 'POST')
    expect(post).toBeTruthy()
    expect(eventIdOf(post)).toBe(DERIVED)
    const body = JSON.parse(post!.body!) as {
      start: { dateTime: string; timeZone: string }
      end: { dateTime: string; timeZone: string }
      reminders: { overrides: Array<{ minutes: number }> }
      extendedProperties: { private: { lifeosTaskId: string } }
    }
    // No offset: the zone carries the meaning, which is what stops the shift.
    expect(body.start.dateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
    expect(body.start.timeZone).toBe('Europe/Amsterdam')
    expect(body.end.timeZone).toBe('Europe/Amsterdam')
    expect(body.reminders.overrides[0].minutes).toBe(15)
    expect(body.extendedProperties.private.lifeosTaskId).toBe(TASK_ID)
    expect(calls.some((c) => c.url.includes('/oauth_access_tokens/'))).toBe(
      true,
    )
  })

  it('writes back the id it created', async () => {
    const t = convexTest(schema, modules)
    await seed(t, { dueAt: 1_800_000_000_000, addToCalendar: true })
    stubGoogle({})
    await sync(t)
    const task = await t.run(async (ctx) =>
      ctx.db
        .query('tasks')
        .withIndex('by_user_id', (q) =>
          q.eq('userId', 'user_a').eq('id', TASK_ID),
        )
        .unique(),
    )
    expect(task?.calendarEventId).toBe('gcal-1')
  })

  it('patches an existing event instead of creating a second one', async () => {
    const t = convexTest(schema, modules)
    await seed(t, {
      dueAt: 1_800_000_000_000,
      addToCalendar: true,
      calendarEventId: 'gcal-1',
    })
    const calls = stubGoogle({})
    const result = await sync(t)
    expect(result.ok && result.action).toBe('updated')
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1)
  })

  it('converges a create that collides with a reserved id', async () => {
    const t = convexTest(schema, modules)
    await seed(t, { dueAt: 1_800_000_000_000, addToCalendar: true })
    const calls = stubGoogle({ createStatus: 409 })
    const result = await sync(t)
    expect(result.ok && result.action).toBe('updated')
    const patch = calls.find((c) => c.method === 'PATCH')
    const body = JSON.parse(patch!.body!) as { status?: string }
    // Confirming is what restores an event left soft-deleted by an earlier
    // delete, which is the only way an un-archive can bring it back.
    expect(body.status).toBe('confirmed')
  })

  it('honours an event the user deleted in Google', async () => {
    const t = convexTest(schema, modules)
    await seed(t, {
      dueAt: 1_800_000_000_000,
      addToCalendar: true,
      calendarEventId: 'gcal-1',
    })
    stubGoogle({ patchCancelled: true })
    const result = await sync(t)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('event_removed')
    const task = await t.run(async (ctx) =>
      ctx.db
        .query('tasks')
        .withIndex('by_user_id', (q) =>
          q.eq('userId', 'user_a').eq('id', TASK_ID),
        )
        .unique(),
    )
    expect(task?.calendarEventId).toBeNull()
  })

  it('removes the event when the task is done', async () => {
    const t = convexTest(schema, modules)
    await seed(t, {
      dueAt: 1_800_000_000_000,
      addToCalendar: true,
      calendarEventId: 'gcal-1',
      done: true,
    })
    const calls = stubGoogle({})
    const result = await sync(t)
    expect(result.ok && result.action).toBe('deleted')
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true)
  })

  it('removes the event when the task is archived', async () => {
    const t = convexTest(schema, modules)
    await seed(t, {
      dueAt: 1_800_000_000_000,
      addToCalendar: true,
      calendarEventId: 'gcal-1',
      archived: true,
    })
    const calls = stubGoogle({})
    const result = await sync(t)
    expect(result.ok && result.action).toBe('deleted')
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true)
  })

  it('removes the event when sync is off', async () => {
    const t = convexTest(schema, modules)
    await seed(
      t,
      {
        dueAt: 1_800_000_000_000,
        addToCalendar: true,
        calendarEventId: 'gcal-1',
      },
      { syncEnabled: false },
    )
    const calls = stubGoogle({})
    const result = await sync(t)
    expect(result.ok && result.action).toBe('deleted')
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true)
  })

  it('refuses a shared task', async () => {
    const t = convexTest(schema, modules)
    await seed(t, {
      dueAt: 1_800_000_000_000,
      addToCalendar: true,
      spaceId: 'space-1',
    })
    const calls = stubGoogle({})
    const result = await sync(t)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not_personal')
    expect(calls).toHaveLength(0)
  })

  it('treats a deleted task as a no-op rather than a failure', async () => {
    const t = convexTest(schema, modules)
    stubGoogle({})
    const result = await sync(t)
    expect(result).toEqual({ ok: true, action: 'noop', link: null })
  })
})

describe('the timezone', () => {
  it('pushes nothing without a zone', async () => {
    const t = convexTest(schema, modules)
    await seed(
      t,
      { dueAt: 1_800_000_000_000, addToCalendar: true },
      { timeZone: null },
    )
    const calls = stubGoogle({})
    const result = await sync(t)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('no_timezone')
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('pushes nothing for a zone the runtime does not know', async () => {
    const t = convexTest(schema, modules)
    await seed(
      t,
      { dueAt: 1_800_000_000_000, addToCalendar: true },
      { timeZone: 'Not/AZone' },
    )
    const calls = stubGoogle({})
    const result = await sync(t)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('no_timezone')
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('builds a half-hour zone wall clock, not a whole-hour one', async () => {
    const t = convexTest(schema, modules)
    // 2026-06-01T00:00:00Z is 05:30 in Kolkata.
    const dueAt = Date.UTC(2026, 5, 1, 0, 0, 0)
    await seed(t, { dueAt, addToCalendar: true }, { timeZone: 'Asia/Kolkata' })
    const calls = stubGoogle({})
    await sync(t)
    const body = JSON.parse(calls.find((c) => c.method === 'POST')!.body!) as {
      start: { dateTime: string }
    }
    expect(body.start.dateTime).toBe('2026-06-01T05:30:00')
  })

  it('builds a DST-boundary wall clock in the target zone', async () => {
    const t = convexTest(schema, modules)
    // 2026-03-29T01:30:00Z is 03:30 in Amsterdam, inside the spring-forward gap.
    const dueAt = Date.UTC(2026, 2, 29, 1, 30, 0)
    await seed(t, { dueAt, addToCalendar: true })
    const calls = stubGoogle({})
    await sync(t)
    const body = JSON.parse(calls.find((c) => c.method === 'POST')!.body!) as {
      start: { dateTime: string }
    }
    expect(body.start.dateTime).toBe('2026-03-29T03:30:00')
  })
})

describe('the error taxonomy', () => {
  it('maps an expired token to a reconnect without calling Google', async () => {
    const t = convexTest(schema, modules)
    await seed(t, { dueAt: 1_800_000_000_000, addToCalendar: true })
    const calls = stubGoogle({
      tokenExpirySeconds: Math.floor(Date.now() / 1000) - 60,
    })
    const result = await sync(t)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('reauth_required')
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('maps a missing scope', async () => {
    const t = convexTest(schema, modules)
    await seed(t, { dueAt: 1_800_000_000_000, addToCalendar: true })
    stubGoogle({ scopes: [] })
    const result = await sync(t)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('missing_scope')
  })

  it('maps a transport refusal from Clerk to not connected', async () => {
    const t = convexTest(schema, modules)
    await seed(t, { dueAt: 1_800_000_000_000, addToCalendar: true })
    stubGoogle({ tokenStatus: 401 })
    const result = await sync(t)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not_connected')
  })

  it('maps a rate limit', async () => {
    const t = convexTest(schema, modules)
    await seed(t, { dueAt: 1_800_000_000_000, addToCalendar: true })
    stubGoogle({ createStatus: 429 })
    const result = await sync(t)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('rate_limited')
  })

  it('maps a Google 401 to a reconnect', async () => {
    const t = convexTest(schema, modules)
    await seed(t, { dueAt: 1_800_000_000_000, addToCalendar: true })
    stubGoogle({ createStatus: 401 })
    const result = await sync(t)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('reauth_required')
  })

  it('maps an unexpected Google answer to a generic error', async () => {
    const t = convexTest(schema, modules)
    await seed(t, { dueAt: 1_800_000_000_000, addToCalendar: true })
    stubGoogle({ createStatus: 500 })
    const result = await sync(t)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('google_error')
  })

  it('treats an already-gone delete as success', async () => {
    const t = convexTest(schema, modules)
    await seed(t, {
      dueAt: 1_800_000_000_000,
      addToCalendar: true,
      calendarEventId: 'gcal-1',
      done: true,
    })
    stubGoogle({ deleteStatus: 410 })
    const result = await sync(t)
    expect(result.ok).toBe(true)
  })
})

describe('cleanup and the write path', () => {
  it('deletes every id it is handed, and tolerates a failure', async () => {
    const t = convexTest(schema, modules)
    await seed(t, {})
    const calls = stubGoogle({ deleteStatus: 410 })
    await t.action(internal.calendar.deleteEventsForUser, {
      userId: 'user_a',
      eventIds: ['gcal-1', 'gcal-2'],
    })
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(2)
  })

  it('does nothing at all for an empty cleanup', async () => {
    const t = convexTest(schema, modules)
    await seed(t, {})
    const calls = stubGoogle({})
    await t.action(internal.calendar.deleteEventsForUser, {
      userId: 'user_a',
      eventIds: [],
    })
    expect(calls).toHaveLength(0)
  })

  it('schedules the create when Add to calendar is turned on', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    // The loaded row has neither an event nor the intent yet, so a predicate
    // reading the old row would miss this and never create anything.
    await seed(t, { dueAt: 1_800_000_000_000 })
    const calls = stubGoogle({})
    await t
      .withIdentity({ subject: 'user_a' })
      .mutation(api.tracker.updateTask, {
        id: TASK_ID,
        addToCalendar: true,
      })
    await settleScheduled(t)
    expect(calls.some((c) => c.method === 'POST')).toBe(true)
  })

  it('schedules nothing for a task with no event and no intent', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    await seed(t, {})
    const calls = stubGoogle({})
    await t
      .withIdentity({ subject: 'user_a' })
      .mutation(api.tracker.updateTask, {
        id: TASK_ID,
        title: 'Renamed',
      })
    await settleScheduled(t)
    expect(calls).toHaveLength(0)
  })

  it('schedules the delete when a synced task is deleted', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    await seed(t, {
      dueAt: 1_800_000_000_000,
      addToCalendar: true,
      calendarEventId: 'gcal-1',
    })
    const calls = stubGoogle({})
    await t
      .withIdentity({ subject: 'user_a' })
      .mutation(api.tracker.deleteTask, {
        id: TASK_ID,
      })
    await settleScheduled(t)
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true)
  })

  it('schedules the cleanup when sync is turned off', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    await seed(t, {
      dueAt: 1_800_000_000_000,
      addToCalendar: true,
      calendarEventId: 'gcal-1',
    })
    const calls = stubGoogle({})
    await t
      .withIdentity({ subject: 'user_a' })
      .mutation(api.settings.updateCalendarSettings, { syncEnabled: false })
    await settleScheduled(t)
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true)
  })
})

describe('the id write-back guard', () => {
  it('cleans up an event it could not record', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    await seed(t, {})
    const calls = stubGoogle({})
    // The row's id is null, but the caller read a different one.
    await t.mutation(internal.calendar.setEventId, {
      userId: 'user_a',
      taskId: TASK_ID,
      calendarEventId: 'gcal-new',
      expect: 'gcal-old',
    })
    await settleScheduled(t)
    const deletes = calls.filter((c) => c.method === 'DELETE')
    expect(deletes).toHaveLength(1)
    expect(deletes[0].url).toContain('gcal-new')
  })

  it('does not delete an event it was recording twice', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    // Two create attempts converging on one deterministic id: the second one
    // sees the id already stored, which must not be treated as an orphan.
    await seed(t, { addToCalendar: true, dueAt: 1_800_000_000_000 })
    const derived = derivedEventId(TASK_ID)
    await t.mutation(internal.calendar.setEventId, {
      userId: 'user_a',
      taskId: TASK_ID,
      calendarEventId: derived,
      expect: null,
    })
    const calls = stubGoogle({})
    await t.mutation(internal.calendar.setEventId, {
      userId: 'user_a',
      taskId: TASK_ID,
      calendarEventId: derived,
      expect: null,
    })
    await settleScheduled(t)
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0)
    const task = await t.run(async (ctx) =>
      ctx.db
        .query('tasks')
        .withIndex('by_user_id', (q) =>
          q.eq('userId', 'user_a').eq('id', TASK_ID),
        )
        .unique(),
    )
    expect(task?.calendarEventId).toBe(derived)
  })
})

describe('a transport failure', () => {
  it('is a typed outcome, not a throw', async () => {
    const t = convexTest(schema, modules)
    await seed(t, { dueAt: 1_800_000_000_000, addToCalendar: true })
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const result = await sync(t)
    // The Clerk leg swallows it as "not connected"; the point is it does not
    // throw out of the action.
    expect(result.ok).toBe(false)
  })

  it('maps a Google-side throw to google_error', async () => {
    const t = convexTest(schema, modules)
    await seed(t, { dueAt: 1_800_000_000_000, addToCalendar: true })
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes('api.clerk.com'))
        return Response.json([
          {
            token: 'tok',
            scopes: [SCOPE],
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          },
        ])
      throw new Error('socket hang up')
    }) as unknown as typeof fetch
    const result = await sync(t)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('google_error')
  })
})

describe('the event-id rule', () => {
  it('skips a shared task and covers stored plus derived ids', () => {
    const ids = eventIdsForTasks([
      { id: TASK_ID, calendarEventId: 'gcal-1', addToCalendar: true, dueAt: 1 },
      {
        id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        calendarEventId: null,
        addToCalendar: true,
        dueAt: 1,
      },
      {
        id: TASK_ID,
        spaceId: 'space-1',
        calendarEventId: 'shared-event',
        addToCalendar: true,
        dueAt: 1,
      },
      { id: TASK_ID, calendarEventId: null, addToCalendar: true, dueAt: null },
    ])
    expect(ids).toContain('gcal-1')
    expect(ids).toContain(DERIVED)
    expect(ids).toContain('aaaaaaaabbbbccccddddeeeeeeeeeeee')
    expect(ids).not.toContain('shared-event')
  })

  it('refuses an id it cannot map without throwing', () => {
    // `a` to `v` plus digits is the whole alphabet, so anything with w to z is
    // unmappable, and so is anything shorter than five characters.
    expect(tryDerivedEventId('task-wxyz')).toBeNull()
    expect(tryDerivedEventId('zzzz-9999')).toBeNull()
    expect(tryDerivedEventId('a-b')).toBeNull()
  })
})

describe('the bounded re-push', () => {
  it('ships the newer state when the row changed mid-flight', async () => {
    const t = convexTest(schema, modules)
    await seed(t, {
      dueAt: 1_800_000_000_000,
      addToCalendar: true,
      calendarEventId: 'gcal-1',
    })
    const bodies: Array<string> = []
    let mutated = false
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input)
      if (url.includes('api.clerk.com'))
        return Response.json([
          {
            token: 'tok',
            scopes: [SCOPE],
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          },
        ])
      bodies.push(String(init?.body ?? ''))
      if (!mutated) {
        mutated = true
        // The edit lands while the Google request is still open.
        await t.run(async (ctx) => {
          const task = await ctx.db
            .query('tasks')
            .withIndex('by_user_id', (q) =>
              q.eq('userId', 'user_a').eq('id', TASK_ID),
            )
            .unique()
          if (task)
            await ctx.db.patch(task._id, { title: 'Renamed mid-flight' })
        })
      }
      return Response.json({ id: 'gcal-1', status: 'confirmed' })
    }) as typeof fetch

    const result = await sync(t)
    expect(result.ok).toBe(true)
    // Two passes: the first carried the old title, the second the new one.
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).not.toContain('Renamed mid-flight')
    expect(bodies[1]).toContain('Renamed mid-flight')
  })
})
