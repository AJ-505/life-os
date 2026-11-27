import type { Checkin } from '../../convex/goalModel'

const WIDTH = 100
const HEIGHT = 24

export function sparkPoints(
  history: Array<Checkin>,
  current: number,
  target: number,
  now: number,
): Array<[number, number]> {
  const end = Math.max(now, history.at(-1)?.at ?? now)
  const points = [...history, { value: current, at: end }]
  const start = points[0].at
  const span = Math.max(end - start, 1)
  const x = (at: number) => ((at - start) / span) * WIDTH
  const y = (value: number) =>
    HEIGHT - (Math.min(value, target) / target) * (HEIGHT - 2) - 1
  return points.flatMap((point, index): Array<[number, number]> => {
    const previous = points[index - 1]
    const here: [number, number] = [x(point.at), y(point.value)]
    if (!previous) return [here]
    return [[x(point.at), y(previous.value)], here]
  })
}

export function Sparkline({
  history,
  current,
  target,
  now,
}: {
  history: Array<Checkin>
  current: number
  target: number
  now: number
}) {
  const points = sparkPoints(history, current, target, now)
  const line = points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
  const area = `0,${HEIGHT} ${line.join(' ')} ${WIDTH},${HEIGHT}`

  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className="h-7 w-full overflow-visible text-proj"
    >
      <polygon points={area} className="fill-current opacity-10" />
      <polyline
        points={line.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
