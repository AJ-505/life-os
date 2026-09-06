import "zod/compile";
import * as z from "zod";

const localSpaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  inviteCode: z.string(),
  createdAt: z.number(),
});

export const localSpace = localSpaceSchema;

export const localSpaces = z.array(localSpaceSchema);

const joinResultSchema = z.object({
  id: z.string().optional(),
  spaceId: z.string().optional(),
  name: z.string(),
  inviteCode: z.string().optional(),
  ownerId: z.string().optional(),
  createdAt: z.number().optional(),
});

export const joinResult = joinResultSchema;

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
});

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
});

const backupFileSchema = z.object({
  app: z.literal("lifeos"),
  version: z.literal(1),
  exportedAt: z.string(),
  projects: z.array(backupProjectSchema),
  tasks: z.array(backupTaskSchema),
});

export const backupFile = backupFileSchema;
