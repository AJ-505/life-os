import { describe, expect, it } from 'vitest'

import {
  BLOCK_MINUTES,
  DEFAULT_BLOCK_MINUTES,
  HOUR_PX,
  atMinute,
  blockShortLabel,
  calendarWeek,
  dropMinute,
  durationUntil,
  hourPxFor,
  isAllDay,
  labelStep,
  minuteOfDay,
  normalizeBlockMinutes,
  placeInLanes,
  resizedMinutes,
  slotMinute,
  visibleDays,
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
    durationMinutes: null,
    repeat: null,
    addToCalendar: false,
    calendarEventId: null,
    calendarSyncIssue: null,
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
  const item = (
    id: string,
    start: number,
    durationMinutes: number | null = null,
  ) => ({
    task: task(id, { durationMinutes }),
    project: project('p1', []),
    occurrence: 0,
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

describe('placeInLanes with mixed durations', () => {
  const item = (id: string, start: number, durationMinutes: number | null) => ({
    task: task(id, { durationMinutes }),
    project: project('p1', []),
    occurrence: 0,
    start,
  })

  it('lets a short task free its lane for the next one', () => {
    const placed = placeInLanes([
      item('long', 540, 180),
      item('short', 550, 15),
      item('after', 570, 30),
    ])
    expect(placed.map((p) => [p.task.id, p.lane, p.lanes])).toEqual([
      ['long', 0, 2],
      ['short', 1, 2],
      ['after', 1, 2],
    ])
  })

  it('keeps a task clear of an earlier long one that spans it', () => {
    const placed = placeInLanes([item('long', 540, 240), item('late', 660, 30)])
    expect(placed.map((p) => [p.lane, p.lanes])).toEqual([
      [0, 2],
      [1, 2],
    ])
  })

  it('separates back to back tasks when the first is shorter than an hour', () => {
    const placed = placeInLanes([item('a', 540, 30), item('b', 570, 30)])
    expect(placed.map((p) => [p.lane, p.lanes])).toEqual([
      [0, 1],
      [0, 1],
    ])
  })

  it('reports minutes per placed task, defaulting to an hour', () => {
    const placed = placeInLanes([item('a', 540, null), item('b', 700, 45)])
    expect(placed.map((p) => p.minutes)).toEqual([60, 45])
  })
})

describe('calendar block size', () => {
  it('offers fine through hourly blocks and falls back to the default', () => {
    expect(BLOCK_MINUTES).toEqual([10, 15, 20, 30, 60])
    expect(DEFAULT_BLOCK_MINUTES).toBe(60)
    expect(normalizeBlockMinutes(20)).toBe(20)
    expect(normalizeBlockMinutes(17)).toBe(DEFAULT_BLOCK_MINUTES)
  })

  it('reads back as a short label', () => {
    expect(blockShortLabel(10)).toBe('10m')
    expect(blockShortLabel(60)).toBe('1h')
  })

  it('stretches the hour only when a block would be too short', () => {
    expect(hourPxFor(10)).toBe(96)
    expect(hourPxFor(15)).toBe(64)
    expect(hourPxFor(20)).toBe(HOUR_PX)
    expect(hourPxFor(30)).toBe(HOUR_PX)
    expect(hourPxFor(60)).toBe(HOUR_PX)
  })

  it('labels a grid at a readable step that matches the blocks', () => {
    expect(labelStep(10)).toBe(30)
    expect(labelStep(15)).toBe(30)
    expect(labelStep(20)).toBe(60)
    expect(labelStep(30)).toBe(30)
    expect(labelStep(60)).toBe(60)
  })

  it('lands a click on the block that contains it', () => {
    expect(slotMinute(HOUR_PX * 9.5, 60)).toBe(570)
    expect(slotMinute(HOUR_PX * 9.99, 60)).toBe(570)
    expect(slotMinute(hourPxFor(10) * 9.5, 10)).toBe(570)
    expect(slotMinute(HOUR_PX * 9.5, 20)).toBe(560)
    expect(slotMinute(hourPxFor(10) * 23.95, 10)).toBe(1430)
  })

  it('snaps drops to the finer of the block and 15 minutes', () => {
    expect(dropMinute(hourPxFor(10) * 9.51, 10, hourPxFor(10))).toBe(570)
    expect(dropMinute(HOUR_PX * 9.5, 60, HOUR_PX)).toBe(570)
  })

  it('resizes in block steps when the block is finer than 15 minutes', () => {
    const hourPx = hourPxFor(10)
    expect(resizedMinutes(540, 60, hourPx / 6, 10, hourPx)).toBe(70)
    expect(resizedMinutes(540, 60, hourPx / 2, 10, hourPx)).toBe(90)
  })
})

describe('resizedMinutes', () => {
  it('adds dragged pixels in 15 minute steps', () => {
    expect(resizedMinutes(540, 60, HOUR_PX / 2)).toBe(90)
    expect(resizedMinutes(540, 60, HOUR_PX / 4 - 1)).toBe(75)
  })

  it('never goes below 15 minutes', () => {
    expect(resizedMinutes(540, 60, -HOUR_PX * 5)).toBe(15)
  })

  it('stops at midnight', () => {
    expect(resizedMinutes(1380, 60, HOUR_PX * 5)).toBe(60)
  })
})

describe('durationUntil', () => {
  it('measures a later end on the same day', () => {
    expect(durationUntil(540, 615)).toBe(75)
  })

  it('rejects an end that is not after the start', () => {
    expect(durationUntil(540, 540)).toBeNull()
    expect(durationUntil(540, 480)).toBeNull()
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

describe('calendarWeek with repeating tasks', () => {
  const days = weekDays(new Date(2026, 9, 14, 12, 0))
  const timedPerDay = (week: ReturnType<typeof calendarWeek>) =>
    week.map((day) => day.timed.length)

  it('places a daily series on every day of the week', () => {
    const board = [
      project('p1', [task('standup', { dueAt: at(14, 10), repeat: 'daily' })]),
    ]
    const week = calendarWeek(board, days, true)
    expect(timedPerDay(week)).toEqual([0, 0, 1, 1, 1, 1, 1])
    expect(week[3].timed[0].start).toBe(600)
    expect(week[3].timed[0].occurrence).toBe(at(15, 10))
  })

  it('places a weekly series only on its weekday', () => {
    const board = [
      project('p1', [task('review', { dueAt: at(7, 10), repeat: 'weekly' })]),
    ]
    const week = calendarWeek(board, days, true)
    expect(timedPerDay(week)).toEqual([0, 0, 1, 0, 0, 0, 0])
    expect(week[2].timed[0].task.id).toBe('review')
  })

  it('keeps every occurrence of one task distinct', () => {
    const board = [
      project('p1', [task('water', { dueAt: at(14, 8), repeat: 'daily' })]),
    ]
    const week = calendarWeek(board, days, true)
    const starts = week.flatMap((day) => day.timed.map((p) => p.occurrence))
    expect(new Set(starts).size).toBe(starts.length)
  })

  it('repeats an all-day series through the all-day row', () => {
    const board = [
      project('p1', [task('pills', { dueAt: at(14, 0), repeat: 'daily' })]),
    ]
    const week = calendarWeek(board, days, true)
    expect(week.map((day) => day.allDay.length)).toEqual([0, 0, 1, 1, 1, 1, 1])
    expect(week[3].allDay[0].occurrence).toBe(at(15, 0))
  })

  it('skips weekends for a weekday series', () => {
    const board = [
      project('p1', [task('desk', { dueAt: at(16, 9), repeat: 'weekdays' })]),
    ]
    const week = calendarWeek(board, days, true)
    expect(timedPerDay(week)).toEqual([0, 0, 0, 0, 1, 0, 0])
  })

  it('hides a done series unless done tasks are shown', () => {
    const board = [
      project('p1', [
        task('daily', {
          dueAt: at(14, 10),
          repeat: 'daily',
          done: true,
          doneAt: 5,
        }),
      ]),
    ]
    expect(calendarWeek(board, days, false)[2].timed).toEqual([])
    expect(calendarWeek(board, days, true)[2].timed).toHaveLength(1)
  })
})

describe('visibleDays', () => {
  it('returns the Monday week for a span of seven', () => {
    const days = visibleDays(new Date(2026, 9, 15, 9), 7)
    expect(days.map((d) => d.getDate())).toEqual([12, 13, 14, 15, 16, 17, 18])
  })

  it('starts a short span on the anchor day', () => {
    const days = visibleDays(new Date(2026, 9, 31, 22), 3)
    expect(days.map((d) => [d.getMonth(), d.getDate(), d.getHours()])).toEqual([
      [9, 31, 0],
      [10, 1, 0],
      [10, 2, 0],
    ])
  })
})
