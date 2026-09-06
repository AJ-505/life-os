import { useCallback, useEffect, useState } from 'react'

/**
 * Numeric UI preference persisted in localStorage (layout chrome only —
 * real data lives in the DB). Reads after mount to stay SSR-safe.
 */
export function useLocalNumber(key: string, initial: number) {
  const [value, setValue] = useState(initial)
  useEffect(() => {
    const stored = localStorage.getItem(key)
    if (stored !== null) {
      const n = Number(stored)
      if (Number.isFinite(n)) setValue(n)
    }
  }, [key])
  // Stable identity like a useState setter, so memoized children that take
  // the updater as a prop don't re-render when the parent does.
  const update = useCallback(
    (v: number) => {
      setValue(v)
      localStorage.setItem(key, String(v))
    },
    [key],
  )
  return [value, update] as const
}
