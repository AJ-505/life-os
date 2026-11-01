import { useEffect, useState } from 'react'

export function useLocalString(key: string, initial: string) {
  const [value, setValue] = useState(initial)
  useEffect(() => {
    const stored = localStorage.getItem(key)
    if (stored !== null) setValue(stored)
  }, [key])
  const update = (v: string) => {
    setValue(v)
    localStorage.setItem(key, v)
  }
  return [value, update] as const
}
