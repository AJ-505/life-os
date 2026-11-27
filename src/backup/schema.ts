import * as z from 'zod'

import { REPEAT_RULES } from '../../convex/recurrence'

const backupProject = z.object({
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

const backupTask = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
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
  reminderMinutes: z.number().nullable().optional(),
  durationMinutes: z.number().int().min(5).max(1440).nullable().optional(),
  addToCalendar: z.boolean().nullable().optional(),
  calendarEventId: z.string().nullable().optional(),
  importedFromEventId: z.string().nullable().optional(),
  repeat: z.enum(REPEAT_RULES).nullable().optional(),
})

const backupGoal = z.object({
  id: z.string(),
  title: z.string(),
  color: z.string(),
  target: z.number(),
  unit: z.string().nullable(),
  targetDate: z.number().nullable(),
  current: z.number(),
  position: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  reachedAt: z.number().nullable(),
  history: z.array(z.object({ value: z.number(), at: z.number() })),
})

export const backupFile = z.object({
  app: z.literal('lifeos'),
  version: z.literal(1),
  exportedAt: z.string(),
  projects: z.array(backupProject),
  tasks: z.array(backupTask),
  goals: z.array(backupGoal).optional(),
})

export type BackupFile = z.infer<typeof backupFile>
