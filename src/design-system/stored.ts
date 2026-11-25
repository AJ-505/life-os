import { useSyncExternalStore } from 'react'

import type * as z from 'zod'

export type Codec<T> = {
  parse: (raw: string) => T | null
  format: (value: T) => string
}

export const flagCodec: Codec<boolean> = {
  parse: (raw) => (raw === '1' ? true : raw === '0' ? false : null),
  format: (value) => (value ? '1' : '0'),
}

export const numberCodec: Codec<number> = {
  parse: (raw) => {
    const value = Number(raw)
    return raw.trim() !== '' && Number.isFinite(value) ? value : null
  },
  format: (value) => String(value),
}

export function textCodec<T extends string>(schema: z.ZodType<T>): Codec<T> {
  return {
    parse: (raw) => {
      const parsed = schema.safeParse(raw)
      return parsed.success ? parsed.data : null
    },
    format: (value) => value,
  }
}

export function jsonCodec<T>(schema: z.ZodType<T>): Codec<T> {
  return {
    parse: (raw) => {
      try {
        const parsed = schema.safeParse(JSON.parse(raw))
        return parsed.success ? parsed.data : null
      } catch {
        return null
      }
    },
    format: (value) => JSON.stringify(value),
  }
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export type StoredValue<T> = {
  fallback: T
  read: () => T
  write: (value: T) => void
  clear: () => void
  subscribe: (listener: () => void) => () => void
}

export function storedValue<T>(
  key: string,
  codec: Codec<T>,
  fallback: T,
): StoredValue<T> {
  const listeners = new Set<() => void>()
  let cachedRaw: string | null = null
  let cachedValue = fallback

  const rawValue = () => {
    try {
      return storage()?.getItem(key) ?? null
    } catch {
      return null
    }
  }

  const read = () => {
    const raw = rawValue()
    if (raw === cachedRaw) return cachedValue
    cachedRaw = raw
    cachedValue = raw === null ? fallback : (codec.parse(raw) ?? fallback)
    return cachedValue
  }

  const notify = () => {
    for (const listener of listeners) listener()
  }

  const put = (raw: string | null) => {
    if (raw === rawValue()) return
    try {
      if (raw === null) storage()?.removeItem(key)
      else storage()?.setItem(key, raw)
    } catch {
      return
    }
    notify()
  }

  return {
    fallback,
    read,
    write: (value) => put(codec.format(value)),
    clear: () => put(null),
    subscribe: (listener) => {
      const onStorage = (event: StorageEvent) => {
        if (event.key === key) listener()
      }
      listeners.add(listener)
      globalThis.addEventListener?.('storage', onStorage)
      return () => {
        listeners.delete(listener)
        globalThis.removeEventListener?.('storage', onStorage)
      }
    },
  }
}

export function useStored<T>(store: StoredValue<T>): [T, (value: T) => void] {
  const value = useSyncExternalStore(
    store.subscribe,
    store.read,
    () => store.fallback,
  )
  return [value, store.write]
}
