import { createServerFn } from '@tanstack/react-start'
import { asc, eq } from 'drizzle-orm'

import { db } from '#/db'
import { projects, tasks } from './schema'

import type { BoardData, ProjectStatus } from './types'

/** Everything, in one query. Views derive what they need client-side. */
export const fetchBoard = createServerFn({ method: 'GET' }).handler(
  async (): Promise<BoardData> => {
    return db.query.projects.findMany({
      with: { tasks: { orderBy: [asc(tasks.position)] } },
      orderBy: [asc(projects.gridCol), asc(projects.gridRow)],
    })
  },
)

export const createProject = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      name: string
      color: string
      gridCol: number
      gridRow: number
    }) => input,
  )
  .handler(async ({ data }) => {
    const name = data.name.trim()
    if (!name) throw new Error('Project name is required')
    const [row] = await db.insert(projects).values({ ...data, name }).returning()
    return row
  })

export const updateProject = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      id: string
      name?: string
      color?: string
      collapsed?: boolean
      targetDate?: string | null
    }) => input,
  )
  .handler(async ({ data }) => {
    const { id, targetDate, ...rest } = data
    const patch: Record<string, unknown> = { ...rest }
    if (targetDate !== undefined) {
      patch.targetDate = targetDate === null ? null : new Date(targetDate)
    }
    const [row] = await db
      .update(projects)
      .set(patch)
      .where(eq(projects.id, id))
      .returning()
    return row
  })

export const moveProject = createServerFn({ method: 'POST' })
  .validator((input: { id: string; gridCol: number; gridRow: number }) => input)
  .handler(async ({ data }) => {
    const [row] = await db
      .update(projects)
      .set({ gridCol: data.gridCol, gridRow: data.gridRow })
      .where(eq(projects.id, data.id))
      .returning()
    return row
  })

export const setProjectStatus = createServerFn({ method: 'POST' })
  .validator((input: { id: string; status: ProjectStatus }) => input)
  .handler(async ({ data }) => {
    const now = new Date()
    const [row] = await db
      .update(projects)
      .set({
        status: data.status,
        finishedAt: data.status === 'done' ? now : null,
        shelvedAt: data.status === 'shelved' ? now : null,
      })
      .where(eq(projects.id, data.id))
      .returning()
    return row
  })

export const deleteProject = createServerFn({ method: 'POST' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    await db.delete(projects).where(eq(projects.id, data.id))
    return { ok: true }
  })

export const createTask = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      projectId: string
      title: string
      position: number
      dueAt?: string | null
    }) => input,
  )
  .handler(async ({ data }) => {
    const title = data.title.trim()
    if (!title) throw new Error('Task title is required')
    const [row] = await db
      .insert(tasks)
      .values({
        projectId: data.projectId,
        title,
        position: data.position,
        dueAt: data.dueAt ? new Date(data.dueAt) : null,
      })
      .returning()
    return row
  })

export const updateTask = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      id: string
      title?: string
      notes?: string | null
      done?: boolean
      archived?: boolean
      dueAt?: string | null
    }) => input,
  )
  .handler(async ({ data }) => {
    const { id, dueAt, done, ...rest } = data
    const patch: Record<string, unknown> = { ...rest }
    if (dueAt !== undefined) patch.dueAt = dueAt === null ? null : new Date(dueAt)
    if (done !== undefined) {
      patch.done = done
      patch.doneAt = done ? new Date() : null
    }
    const [row] = await db
      .update(tasks)
      .set(patch)
      .where(eq(tasks.id, id))
      .returning()
    return row
  })

/** Move within a project or across projects. Focus membership is untouched. */
export const moveTask = createServerFn({ method: 'POST' })
  .validator(
    (input: { id: string; projectId: string; position: number }) => input,
  )
  .handler(async ({ data }) => {
    const [row] = await db
      .update(tasks)
      .set({ projectId: data.projectId, position: data.position })
      .where(eq(tasks.id, data.id))
      .returning()
    return row
  })

/**
 * Focus is a clone-by-reference: toggling it on makes the task appear in the
 * Focus panel while it keeps living inside its project.
 */
export const setTaskFocus = createServerFn({ method: 'POST' })
  .validator(
    (input: { id: string; inFocus: boolean; focusOrder?: number }) => input,
  )
  .handler(async ({ data }) => {
    const [row] = await db
      .update(tasks)
      .set({
        inFocus: data.inFocus,
        focusOrder: data.focusOrder ?? 0,
      })
      .where(eq(tasks.id, data.id))
      .returning()
    return row
  })

export const deleteTask = createServerFn({ method: 'POST' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    await db.delete(tasks).where(eq(tasks.id, data.id))
    return { ok: true }
  })
