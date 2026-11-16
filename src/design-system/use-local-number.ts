import { useEffect, useState } from 'react'

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
