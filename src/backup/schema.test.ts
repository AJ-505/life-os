import { describe, expect, expectTypeOf, it } from 'vitest'

import { backupFile } from './schema'

import type { FunctionArgs, FunctionReturnType } from 'convex/server'
import type * as z from 'zod'
import type { api } from '../../convex/_generated/api'

type Exported = FunctionReturnType<typeof api.backup.exportBackup>
type ImportArgs = FunctionArgs<typeof api.backup.importBackup>

const task = {
  id: 'free',
  projectId: null,
  parentId: null,
  title: 'Loose task',
  notes: null,
  position: 1024,
  done: false,
  doneAt: null,
  archived: false,
  dueAt: null,
  inFocus: false,
  focusOrder: 0,
  createdAt: '2026-11-24T09:00:00.000Z',
  repeat: null,
}

describe('backupFile', () => {
  it('accepts every file the export can produce', () => {
    expectTypeOf<Exported>().toExtend<z.input<typeof backupFile>>()
  })

  it('produces only files the import accepts', () => {
    expectTypeOf<z.output<typeof backupFile>>().toExtend<ImportArgs>()
  })

  it('parses a backup with a task that has no project', () => {
    const parsed = backupFile.safeParse({
      app: 'lifeos',
      version: 1,
      exportedAt: '2026-11-24T09:00:00.000Z',
      projects: [],
      tasks: [task],
    })
    expect(parsed.success).toBe(true)
  })

  it('refuses a file from another app', () => {
    const parsed = backupFile.safeParse({
      app: 'other',
      version: 1,
      exportedAt: '2026-11-24T09:00:00.000Z',
      projects: [],
      tasks: [],
    })
    expect(parsed.success).toBe(false)
  })
})
