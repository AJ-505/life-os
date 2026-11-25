export type CivilTime = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export const DAY_MS = 86_400_000

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

export function civilAt(instant: number, timeZone: string): CivilTime {
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

function civilAsUTC(civil: CivilTime): number {
  return Date.UTC(
    civil.year,
    civil.month - 1,
    civil.day,
    civil.hour,
    civil.minute,
    civil.second,
  )
}

export function offsetMs(instant: number, timeZone: string): number {
  const whole = Math.floor(instant / 1000) * 1000
  return civilAsUTC(civilAt(whole, timeZone)) - whole
}

export function instantAt(
  civil: CivilTime,
  timeZone: string,
  ms: number = 0,
): number {
  const utc = civilAsUTC(civil)
  const first = offsetMs(utc, timeZone)
  let instant = utc - first
  const second = offsetMs(instant, timeZone)
  if (second !== first) instant = utc - second
  return instant + ms
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0')

export function civilDate(civil: CivilTime): string {
  return `${pad(civil.year, 4)}-${pad(civil.month)}-${pad(civil.day)}`
}

export function wallClock(instant: number, timeZone: string): string {
  const civil = civilAt(instant, timeZone)
  return `${civilDate(civil)}T${pad(civil.hour)}:${pad(civil.minute)}:${pad(civil.second)}`
}

export function utcOffset(instant: number, timeZone: string): string {
  const minutes = Math.round(offsetMs(instant, timeZone) / 60_000)
  const sign = minutes < 0 ? '-' : '+'
  const whole = Math.abs(minutes)
  return `${sign}${pad(Math.floor(whole / 60))}:${pad(whole % 60)}`
}

export function isMidnight(instant: number, timeZone: string): boolean {
  const civil = civilAt(instant, timeZone)
  return civil.hour === 0 && civil.minute === 0 && civil.second === 0
}

const YMD = /^([+-]?\d{4})-(\d{2})-(\d{2})$/

export function dayStartIn(ymd: string, timeZone: string): number | null {
  const match = YMD.exec(ymd)
  if (!match) return null
  const [, year, month, day] = match
  if (Number.isNaN(Date.parse(`${ymd}T00:00:00Z`))) return null
  return instantAt(
    {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: 0,
      minute: 0,
      second: 0,
    },
    timeZone,
  )
}

export function nextDate(ymd: string): string {
  const [year, month, day] = ymd.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
}

export function daysBetween(fromYmd: string, untilYmd: string): number {
  const from = Date.parse(`${fromYmd}T00:00:00Z`)
  const until = Date.parse(`${untilYmd}T00:00:00Z`)
  if (Number.isNaN(from) || Number.isNaN(until)) return 1
  return Math.max(1, Math.round((until - from) / DAY_MS))
}
