import 'zod/compile'
import * as z from 'zod'

/** The space row as the server shapes it. */
export const space = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string(),
  inviteCode: z.string(),
  createdAt: z.number(),
})

/**
 * `joinSpaceByCode` returns a discriminated result rather than throwing for the
 * cases a user can act on, so the join page can tell "that link is wrong" apart
 * from "you have tried too often" without reading an error string.
 */
export const joinResult = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    space,
    alreadyMember: z.boolean(),
  }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(['invalid', 'not_found', 'throttled']),
    retryAfterMinutes: z.number().optional(),
  }),
])

const backupProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  status: z.string().nullable(),
  collapsed: z.boolean().nullable(),
  gridCol: z.number().nullable(),
  gridRow: z.number().nullable(),
  targetDate: z.string().nullable(),
  createdAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  shelvedAt: z.string().nullable(),
})

const backupTaskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  parentId: z.string().nullable().optional(),
  title: z.string(),
  notes: z.string().nullable(),
  position: z.number().nullable(),
  done: z.boolean().nullable(),
  doneAt: z.string().nullable(),
  archived: z.boolean().nullable(),
  dueAt: z.string().nullable(),
  inFocus: z.boolean().nullable(),
  focusOrder: z.number().nullable(),
  createdAt: z.string().nullable(),
  // Optional so a backup written before the calendar work still validates.
  reminderMinutes: z.number().nullable().optional(),
  addToCalendar: z.boolean().nullable().optional(),
  calendarEventId: z.string().nullable().optional(),
})

const backupFileSchema = z.object({
  app: z.literal('lifeos'),
  version: z.literal(1),
  exportedAt: z.string(),
  projects: z.array(backupProjectSchema),
  tasks: z.array(backupTaskSchema),
})

export const backupFile = backupFileSchema
