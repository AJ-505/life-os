import { describe, expect, it } from 'vitest'

import {
  HOUR_PX,
  atMinute,
  calendarWeek,
  dropMinute,
  isAllDay,
  minuteOfDay,
  placeInLanes,
  weekDays,
} from './calendar-logic'

import type { ProjectWithTasks, Task } from '../types'

const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).getTime()

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    projectId: 'p1',
    parentId: null,
    title: id,
    notes: null,
    position: 1,
    done: false,
    doneAt: null,
    archived: false,
    dueAt: null,
    reminderMinutes: null,
    addToCalendar: false,
    calendarEventId: null,
    inFocus: false,
    focusOrder: 0,
    createdAt: 1,
    assigneeId: null,
    spaceId: null,
    ...overrides,
  }
}

function project(
  id: string,
  tasks: Array<Task>,
  overrides: Partial<ProjectWithTasks> = {},
): ProjectWithTasks {
  return {
    id,
    name: id,
    color: 'moss',
    status: 'active',
    collapsed: false,
    showDone: true,
    gridCol: 0,
    gridRow: 1,
    targetDate: null,
    createdAt: 1,
    finishedAt: null,
    shelvedAt: null,
    spaceId: null,
    tasks,
    ...overrides,
  }
}

describe('weekDays', () => {
  it('starts on the Monday of a Wednesday anchor', () => {
    const days = weekDays(new Date(2026, 9, 14, 15, 0))
    expect(days).toHaveLength(7)
    expect(days[0]).toEqual(new Date(2026, 9, 12))
    expect(days[6]).toEqual(new Date(2026, 9, 18))
  })

  it('puts a Sunday anchor in the week that starts the Monday before', () => {
    const days = weekDays(new Date(2026, 9, 18, 8, 0))
    expect(days[0]).toEqual(new Date(2026, 9, 12))
    expect(days[6]).toEqual(new Date(2026, 9, 18))
  })
})

describe('minuteOfDay and isAllDay', () => {
  it('treats midnight as all-day', () => {
    expect(isAllDay(at(14, 0))).toBe(true)
    expect(minuteOfDay(at(14, 0))).toBe(0)
  })

  it('reads 09:30 as minute 570 and not all-day', () => {
    expect(minuteOfDay(at(14, 9, 30))).toBe(570)
    expect(isAllDay(at(14, 9, 30))).toBe(false)
  })
})

describe('atMinute', () => {
  it('places a minute on the same local date as the day start', () => {
    const dayStart = new Date(2026, 9, 14).getTime()
    const result = new Date(atMinute(dayStart, 570))
    expect(result.getFullYear()).toBe(2026)
    expect(result.getMonth()).toBe(9)
    expect(result.getDate()).toBe(14)
    expect(result.getHours()).toBe(9)
    expect(result.getMinutes()).toBe(30)
  })
})

describe('dropMinute', () => {
  it('snaps to the nearest 15 minutes', () => {
    expect(dropMinute(HOUR_PX * 9.5)).toBe(570)
    expect(dropMinute(24)).toBe(30)
    expect(dropMinute(6)).toBe(15)
  })

  it('clamps above zero to 15 minutes', () => {
    expect(dropMinute(0)).toBe(15)
    expect(dropMinute(-100)).toBe(15)
  })

  it('clamps below the end of the day to 1425 minutes', () => {
    expect(dropMinute(HOUR_PX * 24)).toBe(1425)
    expect(dropMinute(100_000)).toBe(1425)
  })
})

describe('placeInLanes', () => {
  const item = (id: string, start: number) => ({
    task: task(id),
    project: project('p1', []),
    start,
  })
  const summary = (items: ReturnType<typeof placeInLanes>) =>
    items.map((p) => ({
      id: p.task.id,
      lane: p.lane,
      lanes: p.lanes,
    }))

  it('gives non-overlapping tasks a single lane each', () => {
    const placed = placeInLanes([item('a', 540), item('b', 660)])
    expect(summary(placed)).toEqual([
      { id: 'a', lane: 0, lanes: 1 },
      { id: 'b', lane: 0, lanes: 1 },
    ])
  })

  it('splits two tasks at the same minute into two lanes', () => {
    const placed = placeInLanes([item('a', 540), item('b', 540)])
    expect(summary(placed)).toEqual([
      { id: 'a', lane: 0, lanes: 2 },
      { id: 'b', lane: 1, lanes: 2 },
    ])
  })

  it('keeps a chain of overlaps in one cluster and reuses a freed lane', () => {
    const placed = placeInLanes([
      item('nine', 540),
      item('nineThirty', 570),
      item('tenFifteen', 615),
    ])
    expect(summary(placed)).toEqual([
      { id: 'nine', lane: 0, lanes: 2 },
      { id: 'nineThirty', lane: 1, lanes: 2 },
      { id: 'tenFifteen', lane: 0, lanes: 2 },
    ])
  })

  it('starts a fresh cluster for a task after the chain ends', () => {
    const placed = placeInLanes([
      item('nine', 540),
      item('nineThirty', 570),
      item('tenFifteen', 615),
      item('eleven', 675),
    ])
    expect(summary(placed).at(-1)).toEqual({ id: 'eleven', lane: 0, lanes: 1 })
  })
})

describe('calendarWeek', () => {
  const days = weekDays(new Date(2026, 9, 14, 12, 0))
  const wednesday = 2
  const thursday = 3

  it('excludes archived tasks', () => {
    const board = [
      project('p1', [
        task('archived', { dueAt: at(14, 10), archived: true }),
        task('live', { dueAt: at(14, 11) }),
      ]),
    ]
    const wed = calendarWeek(board, days, true)[wednesday]
    expect(wed.timed.map((p) => p.task.id)).toEqual(['live'])
  })

  it('excludes done tasks unless showDone is true', () => {
    const board = [
      project('p1', [
        task('done', { dueAt: at(14, 10), done: true, doneAt: 5 }),
        task('open', { dueAt: at(14, 11) }),
      ]),
    ]
    const hidden = calendarWeek(board, days, false)[wednesday]
    expect(hidden.timed.map((p) => p.task.id)).toEqual(['open'])
    const shown = calendarWeek(board, days, true)[wednesday]
    expect(shown.timed.map((p) => p.task.id)).toEqual(['done', 'open'])
  })

  it('excludes tasks outside the week', () => {
    const board = [
      project('p1', [
        task('before', { dueAt: at(11, 10) }),
        task('after', { dueAt: at(19, 10) }),
      ]),
    ]
    const week = calendarWeek(board, days, true)
    expect(
      week.every((d) => d.timed.length === 0 && d.allDay.length === 0),
    ).toBe(true)
  })

  it('places a midnight task in allDay', () => {
    const board = [project('p1', [task('birthday', { dueAt: at(14, 0) })])]
    const wed = calendarWeek(board, days, true)[wednesday]
    expect(wed.allDay.map((t) => t.task.id)).toEqual(['birthday'])
    expect(wed.timed).toEqual([])
  })

  it('places a timed task in timed with its start minute', () => {
    const board = [project('p1', [task('standup', { dueAt: at(14, 9, 30) })])]
    const wed = calendarWeek(board, days, true)[wednesday]
    expect(wed.allDay).toEqual([])
    expect(wed.timed).toHaveLength(1)
    expect(wed.timed[0].task.id).toBe('standup')
    expect(wed.timed[0].start).toBe(570)
  })

  it('ignores tasks in shelved and done projects', () => {
    const board = [
      project('shelvedP', [task('s', { dueAt: at(14, 10) })], {
        status: 'shelved',
      }),
      project('doneP', [task('d', { dueAt: at(14, 11) })], { status: 'done' }),
      project('activeP', [task('a', { dueAt: at(14, 12) })]),
    ]
    const wed = calendarWeek(board, days, true)[wednesday]
    expect(wed.timed.map((p) => p.task.id)).toEqual(['a'])
  })

  it('lists an active project milestone on its target day', () => {
    const launch = project('launch', [], { targetDate: at(15, 9) })
    const week = calendarWeek([launch], days, true)
    expect(week[thursday].milestones.map((p) => p.id)).toEqual(['launch'])
    expect(week[wednesday].milestones).toEqual([])
  })
})
