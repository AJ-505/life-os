import { relations } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  boolean,
  doublePrecision,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Project lifecycle:
 * - active:  lives on the board
 * - shelved: temporarily out of sight & out of mind (can be restored)
 * - done:    finished, shows up in the Accomplished view
 * Permanent removal is a hard delete (cascades to tasks).
 */
export const projectStatus = pgEnum('project_status', [
  'active',
  'shelved',
  'done',
])

export const projects = pgTable('projects', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  color: text().notNull().default('moss'),
  status: projectStatus().notNull().default('active'),
  collapsed: boolean().notNull().default(false),
  // Board placement: column index + fractional row for cheap reordering
  gridCol: integer('grid_col').notNull().default(0),
  gridRow: doublePrecision('grid_row').notNull().default(0),
  targetDate: timestamp('target_date', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  shelvedAt: timestamp('shelved_at', { withTimezone: true }),
})

export const tasks = pgTable('tasks', {
  id: uuid().primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  // Self-reference: a task can nest under another task, infinitely deep.
  parentId: uuid('parent_id').references((): AnyPgColumn => tasks.id, {
    onDelete: 'cascade',
  }),
  title: text().notNull(),
  notes: text(),
  position: doublePrecision().notNull().default(0),
  done: boolean().notNull().default(false),
  doneAt: timestamp('done_at', { withTimezone: true }),
  archived: boolean().notNull().default(false),
  dueAt: timestamp('due_at', { withTimezone: true }),
  // Focus is a reference, not a move: the task stays in its project and
  // simultaneously appears in the Focus panel.
  inFocus: boolean('in_focus').notNull().default(false),
  focusOrder: doublePrecision('focus_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const projectsRelations = relations(projects, ({ many }) => ({
  tasks: many(tasks),
}))

export const tasksRelations = relations(tasks, ({ one }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
}))
