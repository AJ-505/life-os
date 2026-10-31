import { useEffect, useState } from 'react'

export function useLocalFlag(key: string, initial: boolean) {
  const [value, setValue] = useState(initial)
  useEffect(() => {
    const stored = localStorage.getItem(key)
    if (stored !== null) setValue(stored === '1')
  }, [key])
  const update = (v: boolean) => {
    setValue(v)
    localStorage.setItem(key, v ? '1' : '0')
  }
  return [value, update] as const
}
