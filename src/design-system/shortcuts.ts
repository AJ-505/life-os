import { useEffect, useRef } from 'react'

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  )
}

export function isPlainKey(event: KeyboardEvent): boolean {
  return (
    !isTyping(event.target) && !event.metaKey && !event.ctrlKey && !event.altKey
  )
}

export function useKeyShortcuts(onKey: (event: KeyboardEvent) => void) {
  const latest = useRef(onKey)
  useEffect(() => {
    latest.current = onKey
  })
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (isPlainKey(event)) latest.current(event)
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
}
