import { createServerFn } from '@tanstack/react-start'

import { db } from '#/db'
import { projects, tasks } from '#/tracker/schema'

/** Wire format: dates travel as ISO strings inside the JSON file. */
interface BackupProject {
  id: string
  name: string
  color: string | null
  status: string | null
  collapsed: boolean | null
  gridCol: number | null
  gridRow: number | null
  targetDate: string | null
  createdAt: string | null
  finishedAt: string | null
  shelvedAt: string | null
}

interface BackupTask {
  id: string
  projectId: string
  title: string
  notes: string | null
  position: number | null
  done: boolean | null
  doneAt: string | null
  archived: boolean | null
  dueAt: string | null
  inFocus: boolean | null
  focusOrder: number | null
  createdAt: string | null
}

export interface BackupFile {
  app: 'lifeos'
  version: 1
  exportedAt: string
  projects: Array<BackupProject>
  tasks: Array<BackupTask>
}

const iso = (v: Date | null) => (v ? v.toISOString() : null)

export const exportBackup = createServerFn({ method: 'GET' }).handler(
  async (): Promise<BackupFile> => {
    const [allProjects, allTasks] = await Promise.all([
      db.select().from(projects),
      db.select().from(tasks),
    ])
    return {
      app: 'lifeos',
      version: 1,
      exportedAt: new Date().toISOString(),
      projects: allProjects.map((p) => ({
        ...p,
        targetDate: iso(p.targetDate),
        createdAt: iso(p.createdAt),
        finishedAt: iso(p.finishedAt),
        shelvedAt: iso(p.shelvedAt),
      })),
      tasks: allTasks.map((t) => ({
        ...t,
        doneAt: iso(t.doneAt),
        dueAt: iso(t.dueAt),
        createdAt: iso(t.createdAt),
      })),
    }
  },
)

const date = (v: unknown) => (v ? new Date(v as string) : null)

/** Replaces everything. The UI confirms loudly before calling this. */
export const importBackup = createServerFn({ method: 'POST' })
  .validator((input: BackupFile) => {
    const raw: Partial<BackupFile> = input
    if (raw.app !== 'lifeos' || !Array.isArray(raw.projects)) {
      throw new Error('Not a LifeOS backup file')
    }
    return input
  })
  .handler(async ({ data }) => {
    await db.transaction(async (tx) => {
      await tx.delete(tasks)
      await tx.delete(projects)
      if (data.projects.length > 0) {
        await tx.insert(projects).values(
          data.projects.map((p) => ({
            id: p.id,
            name: p.name,
            color: p.color ?? 'moss',
            status: (p.status ?? 'active') as 'active' | 'shelved' | 'done',
            collapsed: Boolean(p.collapsed),
            gridCol: Number(p.gridCol ?? 0),
            gridRow: Number(p.gridRow ?? 0),
            targetDate: date(p.targetDate),
            createdAt: date(p.createdAt) ?? new Date(),
            finishedAt: date(p.finishedAt),
            shelvedAt: date(p.shelvedAt),
          })),
        )
      }
      if (data.tasks.length > 0) {
        await tx.insert(tasks).values(
          data.tasks.map((t) => ({
            id: t.id,
            projectId: t.projectId,
            title: t.title,
            notes: (t.notes) ?? null,
            position: Number(t.position ?? 0),
            done: Boolean(t.done),
            doneAt: date(t.doneAt),
            archived: Boolean(t.archived),
            dueAt: date(t.dueAt),
            inFocus: Boolean(t.inFocus),
            focusOrder: Number(t.focusOrder ?? 0),
            createdAt: date(t.createdAt) ?? new Date(),
          })),
        )
      }
    })
    return {
      ok: true,
      projects: data.projects.length,
      tasks: data.tasks.length,
    }
  })
