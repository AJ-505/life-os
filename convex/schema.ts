import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

import { repeatRule } from './recurrence'
import { activityKind, projectStatus, syncIssue } from './taskModel'

export default defineSchema({
  projects: defineTable({
    userId: v.string(),
    id: v.string(),
    name: v.string(),
    color: v.string(),
    status: projectStatus,
    collapsed: v.boolean(),
    showDone: v.optional(v.boolean()),
    gridCol: v.number(),
    gridRow: v.number(),
    targetDate: v.union(v.number(), v.null()),
    createdAt: v.number(),
    finishedAt: v.union(v.number(), v.null()),
    shelvedAt: v.union(v.number(), v.null()),
    spaceId: v.optional(v.union(v.string(), v.null())),
  })
    .index('by_user', ['userId'])
    .index('by_user_space', ['userId', 'spaceId'])
    .index('by_user_id', ['userId', 'id'])
    .index('by_space', ['spaceId'])
    .index('by_app_id', ['id']),

  tasks: defineTable({
    userId: v.string(),
    id: v.string(),
    projectId: v.union(v.string(), v.null()),
    parentId: v.union(v.string(), v.null()),
    title: v.string(),
    notes: v.union(v.string(), v.null()),
    position: v.number(),
    done: v.boolean(),
    doneAt: v.union(v.number(), v.null()),
    archived: v.boolean(),
    dueAt: v.union(v.number(), v.null()),
    reminderMinutes: v.optional(v.union(v.number(), v.null())),
    durationMinutes: v.optional(v.union(v.number(), v.null())),
    repeat: v.optional(v.union(repeatRule, v.null())),
    addToCalendar: v.optional(v.boolean()),
    calendarEventId: v.optional(v.union(v.string(), v.null())),
    calendarSyncIssue: v.optional(syncIssue),
    importedFromEventId: v.optional(v.union(v.string(), v.null())),
    inFocus: v.boolean(),
    focusOrder: v.number(),
    createdAt: v.number(),
    createdFrom: v.optional(v.literal('calendar')),
    assigneeId: v.optional(v.union(v.string(), v.null())),
    spaceId: v.optional(v.union(v.string(), v.null())),
  })
    .index('by_user', ['userId'])
    .index('by_user_id', ['userId', 'id'])
    .index('by_app_id', ['id'])
    .index('by_space', ['spaceId'])
    .index('by_user_space', ['userId', 'spaceId'])
    .index('by_user_project', ['userId', 'projectId'])
    .index('by_space_project', ['spaceId', 'projectId'])
    .index('by_space_assignee', ['spaceId', 'assigneeId'])
    .index('by_created_from_due', ['createdFrom', 'dueAt'])
    .index('by_user_sync_issue', ['userId', 'calendarSyncIssue']),

  userProfiles: defineTable({
    userId: v.string(),
    displayName: v.string(),
    email: v.optional(v.string()),
    updatedAt: v.number(),
  }).index('by_user', ['userId']),

  taskActivity: defineTable({
    spaceId: v.string(),
    taskId: v.string(),
    projectId: v.union(v.string(), v.null()),
    actorId: v.string(),
    kind: activityKind,
    fromUserId: v.optional(v.union(v.string(), v.null())),
    toUserId: v.optional(v.union(v.string(), v.null())),
    detail: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_space_task', ['spaceId', 'taskId']),

  spaces: defineTable({
    id: v.string(),
    ownerId: v.string(),
    name: v.string(),
    inviteCode: v.string(),
    createdAt: v.number(),
  })
    .index('by_inviteCode', ['inviteCode'])
    .index('by_app_id', ['id']),

  spaceMembers: defineTable({
    spaceId: v.string(),
    userId: v.string(),
    role: v.union(v.literal('owner'), v.literal('member')),
    joinedAt: v.number(),
  })
    .index('by_space', ['spaceId'])
    .index('by_user', ['userId'])
    .index('by_space_user', ['spaceId', 'userId']),

  userSettings: defineTable({
    userId: v.string(),
    calendarEnabled: v.optional(v.boolean()),
    calendarSyncEnabled: v.boolean(),
    defaultReminderMinutes: v.number(),
    autoAddToCalendar: v.optional(v.boolean()),
    googleConnected: v.optional(v.boolean()),
    timeZone: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_user', ['userId']),

  lastProjects: defineTable({
    userId: v.string(),
    spaceId: v.union(v.string(), v.null()),
    projectId: v.string(),
    updatedAt: v.number(),
  })
    .index('by_user_space', ['userId', 'spaceId'])
    .index('by_space', ['spaceId']),

  calendarEvents: defineTable({
    userId: v.string(),
    eventId: v.string(),
    title: v.string(),
    notes: v.union(v.string(), v.null()),
    location: v.union(v.string(), v.null()),
    allDay: v.boolean(),
    start: v.number(),
    end: v.number(),
    link: v.union(v.string(), v.null()),
    fetchedAt: v.number(),
  })
    .index('by_user_eventId', ['userId', 'eventId'])
    .index('by_user_start', ['userId', 'start'])
    .index('by_user_fetchedAt', ['userId', 'fetchedAt'])
    .index('by_fetchedAt', ['fetchedAt']),

  inviteAttempts: defineTable({
    userId: v.string(),
    count: v.number(),
    windowStartAt: v.number(),
  }).index('by_user', ['userId']),

  releases: defineTable({
    buildId: v.string(),
    publishedAt: v.number(),
  }),
})
