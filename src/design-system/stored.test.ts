import * as z from 'zod'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  flagCodec,
  jsonCodec,
  numberCodec,
  storedValue,
  textCodec,
} from './stored'

function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
  })
  return store
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const point = z.object({ x: z.number() })

describe('storedValue', () => {
  it('returns the fallback when nothing is stored', () => {
    stubStorage()
    expect(storedValue('k', flagCodec, true).read()).toBe(true)
  })

  it('round-trips a value and clears it', () => {
    const store = stubStorage()
    const value = storedValue('k', numberCodec, 320)
    value.write(400)
    expect(store.get('k')).toBe('400')
    expect(value.read()).toBe(400)
    value.clear()
    expect(value.read()).toBe(320)
  })

  it('returns the fallback for bad JSON or the wrong shape', () => {
    stubStorage({ bad: '{nope', wrong: '{"x":"1"}' })
    const fallback = { x: 0 }
    expect(storedValue('bad', jsonCodec(point), fallback).read()).toBe(fallback)
    expect(storedValue('wrong', jsonCodec(point), fallback).read()).toBe(
      fallback,
    )
  })

  it('returns the same object until the stored text changes', () => {
    stubStorage({ k: '{"x":1}' })
    const value = storedValue('k', jsonCodec(point), { x: 0 })
    const first = value.read()
    expect(value.read()).toBe(first)
    value.write({ x: 2 })
    expect(value.read()).toEqual({ x: 2 })
    expect(value.read()).not.toBe(first)
  })

  it('notifies once per change, and not after unsubscribe', () => {
    stubStorage()
    const value = storedValue('k', flagCodec, false)
    const listener = vi.fn()
    const unsubscribe = value.subscribe(listener)
    value.write(true)
    value.write(true)
    value.write(false)
    unsubscribe()
    value.write(true)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('does not throw when storage refuses the write', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      },
      removeItem: () => {
        throw new Error('quota exceeded')
      },
    })
    const value = storedValue('k', flagCodec, false)
    expect(() => value.write(true)).not.toThrow()
    expect(() => value.clear()).not.toThrow()
    expect(value.read()).toBe(false)
  })

  it('returns the fallback when storage itself is missing', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(storedValue('k', flagCodec, true).read()).toBe(true)
  })

  it('hears a change made in another tab', () => {
    stubStorage()
    const handlers: Array<(event: { key: string }) => void> = []
    vi.stubGlobal('addEventListener', (_: string, handler: never) =>
      handlers.push(handler),
    )
    vi.stubGlobal('removeEventListener', () => {})
    const value = storedValue('k', flagCodec, false)
    const listener = vi.fn()
    value.subscribe(listener)
    for (const handler of handlers) handler({ key: 'other' })
    for (const handler of handlers) handler({ key: 'k' })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('codecs', () => {
  it('reads only the flag texts it writes', () => {
    expect(flagCodec.parse('1')).toBe(true)
    expect(flagCodec.parse('0')).toBe(false)
    expect(flagCodec.parse('true')).toBeNull()
  })

  it('refuses text that is not a finite number', () => {
    expect(numberCodec.parse('12.5')).toBe(12.5)
    expect(numberCodec.parse('')).toBeNull()
    expect(numberCodec.parse('NaN')).toBeNull()
  })

  it('keeps raw text that matches the schema', () => {
    const theme = textCodec(z.enum(['light', 'dark']))
    expect(theme.parse('dark')).toBe('dark')
    expect(theme.format('light')).toBe('light')
    expect(theme.parse('blue')).toBeNull()
  })
})
