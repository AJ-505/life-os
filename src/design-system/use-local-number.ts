import { useEffect, useState } from 'react'

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
  const update = (v: number) => {
    setValue(v)
    localStorage.setItem(key, String(v))
  }
  /**
   * Same state, but the localStorage write waits for `commit`. For a drag
   * ticking at 60Hz that is one write on release instead of one per
   * pointermove; the in-memory state updates every tick either way, so the
   * resize feedback stays instant.
   */
  const [pending, setPending] = useState<number | null>(null)
  const updateDeferred = (v: number) => {
    setValue(v)
    setPending(v)
  }
  const commit = () => {
    if (pending !== null) {
      localStorage.setItem(key, String(pending))
      setPending(null)
    }
  }
  return [value, update, updateDeferred, commit] as const
}
