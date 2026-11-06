export const REPEAT_RULES = [
  'daily',
  'weekdays',
  'weekly',
  'monthly',
  'yearly',
] as const

export type RepeatRule = (typeof REPEAT_RULES)[number]

const DAY_MS = 86_400_000
const MAX_STEPS = 1_000

type CivilTime = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

type Anchor = { civil: CivilTime; ms: number }

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone)
  if (cached) return cached
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  formatters.set(timeZone, created)
  return created
}

export function usableTimeZone(
  value: string | null | undefined,
): string | null {
  if (!value) return null
  try {
    formatter(value)
    return value
  } catch {
    return null
  }
}

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

export function isRepeatRule(value: unknown): value is RepeatRule {
  return REPEAT_RULES.some((rule) => rule === value)
}

function civilAt(instant: number, timeZone: string): CivilTime {
  const parts = formatter(timeZone).formatToParts(new Date(instant))
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type)
    return part ? Number(part.value) : 0
  }
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  }
}

function offsetMs(instant: number, timeZone: string): number {
  const whole = Math.floor(instant / 1000) * 1000
  const civil = civilAt(whole, timeZone)
  return (
    Date.UTC(
      civil.year,
      civil.month - 1,
      civil.day,
      civil.hour,
      civil.minute,
      civil.second,
    ) - whole
  )
}

function instantAt(civil: CivilTime, ms: number, timeZone: string): number {
  const utc = Date.UTC(
    civil.year,
    civil.month - 1,
    civil.day,
    civil.hour,
    civil.minute,
    civil.second,
  )
  const first = offsetMs(utc, timeZone)
  let instant = utc - first
  const second = offsetMs(instant, timeZone)
  if (second !== first) instant = utc - second
  return instant + ms
}

function civilDay(civil: CivilTime): Date {
  return new Date(Date.UTC(civil.year, civil.month - 1, civil.day))
}

function addDays(civil: CivilTime, days: number): CivilTime {
  const moved = new Date(
    Date.UTC(civil.year, civil.month - 1, civil.day + days),
  )
  return {
    ...civil,
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
  }
}

function addMonths(civil: CivilTime, months: number): CivilTime {
  const index = civil.year * 12 + (civil.month - 1) + months
  const year = Math.floor(index / 12)
  const month = index - year * 12
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return {
    ...civil,
    year,
    month: month + 1,
    day: Math.min(civil.day, lastDay),
  }
}

function isWeekend(civil: CivilTime): boolean {
  const weekday = civilDay(civil).getUTCDay()
  return weekday === 0 || weekday === 6
}

function advanceCivil(
  civil: CivilTime,
  rule: RepeatRule,
  index: number,
): CivilTime {
  switch (rule) {
    case 'daily':
      return addDays(civil, index)
    case 'weekly':
      return addDays(civil, index * 7)
    case 'monthly':
      return addMonths(civil, index)
    case 'yearly':
      return addMonths(civil, index * 12)
    case 'weekdays': {
      let next = civil
      for (let step = 0; step < index; step++) {
        next = addDays(next, 1)
        while (isWeekend(next)) next = addDays(next, 1)
      }
      return next
    }
  }
}

function anchorOf(instant: number, timeZone: string): Anchor {
  const remainder = ((instant % 1000) + 1000) % 1000
  return { civil: civilAt(instant, timeZone), ms: remainder }
}

function occurrenceAt(
  anchor: Anchor,
  rule: RepeatRule,
  index: number,
  timeZone: string,
): number {
  return instantAt(advanceCivil(anchor.civil, rule, index), anchor.ms, timeZone)
}

function startIndex(
  anchor: Anchor,
  anchorInstant: number,
  rule: RepeatRule,
  from: number,
  timeZone: string,
): number {
  if (rule === 'daily' || rule === 'weekly') {
    const step = rule === 'daily' ? DAY_MS : 7 * DAY_MS
    return Math.max(0, Math.floor((from - anchorInstant) / step) - 1)
  }
  const target = civilAt(from, timeZone)
  const months =
    (target.year - anchor.civil.year) * 12 + (target.month - anchor.civil.month)
  const distance = rule === 'monthly' ? months : target.year - anchor.civil.year
  return Math.max(0, distance - 1)
}

export function occurrencesBetween(
  anchorInstant: number,
  rule: RepeatRule,
  from: number,
  to: number,
  timeZone: string,
): Array<number> {
  const zone = usableTimeZone(timeZone) ?? 'UTC'
  if (to < anchorInstant || to < from) return []
  const anchor = anchorOf(anchorInstant, zone)
  const start = Math.max(from, anchorInstant)

  if (rule === 'weekdays') {
    const first = civilAt(start, zone)
    let civil = {
      ...anchor.civil,
      year: first.year,
      month: first.month,
      day: first.day,
    }
    const days = Math.min(MAX_STEPS, Math.ceil((to - start) / DAY_MS) + 9)
    const found: Array<number> = []
    for (let step = 0; step < days; step++) {
      if (!isWeekend(civil)) {
        const at = instantAt(civil, anchor.ms, zone)
        if (at > to) break
        if (at >= from && at >= anchorInstant) found.push(at)
      }
      civil = addDays(civil, 1)
    }
    return found
  }

  const found: Array<number> = []
  const steps = Math.min(
    MAX_STEPS,
    Math.max(1, Math.ceil((to - start) / DAY_MS) + 8),
  )
  let index = startIndex(anchor, anchorInstant, rule, start, zone)
  for (let step = 0; step < steps; step++) {
    const at = occurrenceAt(anchor, rule, index, zone)
    if (at > to) break
    if (at >= from && at >= anchorInstant) found.push(at)
    index++
  }
  return found
}

export function nextOccurrence(
  anchorInstant: number,
  rule: RepeatRule,
  after: number,
  timeZone: string,
): number | null {
  const zone = usableTimeZone(timeZone) ?? 'UTC'
  const threshold = Math.max(after, anchorInstant)
  const anchor = anchorOf(anchorInstant, zone)

  if (rule === 'weekdays') {
    const from = civilAt(threshold, zone)
    let civil = addDays(
      { ...anchor.civil, year: from.year, month: from.month, day: from.day },
      1,
    )
    for (let step = 0; step < 9; step++) {
      if (!isWeekend(civil)) {
        const at = instantAt(civil, anchor.ms, zone)
        if (at > threshold) return at
      }
      civil = addDays(civil, 1)
    }
    return null
  }

  let index = Math.max(
    1,
    startIndex(anchor, anchorInstant, rule, threshold, zone),
  )
  for (let step = 0; step < MAX_STEPS; step++) {
    const at = occurrenceAt(anchor, rule, index, zone)
    if (at > threshold) return at
    index++
  }
  return null
}
