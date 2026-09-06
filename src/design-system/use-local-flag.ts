import { useCallback, useEffect, useState } from 'react'

/**
 * Boolean UI preference persisted in localStorage (layout chrome only —
 * real data lives in the DB). Reads after mount to stay SSR-safe.
 */
export function useLocalFlag(key: string, initial: boolean) {
  const [value, setValue] = useState(initial)
  useEffect(() => {
    const stored = localStorage.getItem(key)
    if (stored !== null) setValue(stored === '1')
  }, [key])
  // Stable identity like a useState setter, so memoized children that take
  // the updater as a prop don't re-render when the parent does.
  const update = useCallback(
    (v: boolean) => {
      setValue(v)
      localStorage.setItem(key, v ? '1' : '0')
    },
    [key],
  )
  return [value, update] as const
}
