import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  readLastSpaces,
  resolveSpacesHref,
  spacesEntryFor,
  writeLastSpaces,
} from './last-space'

function stubLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  const fake = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
  }
  vi.stubGlobal('localStorage', fake)
  return store
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveSpacesHref', () => {
  it('goes to the index when nothing is stored', () => {
    expect(resolveSpacesHref(null, ['a'])).toEqual({ to: '/spaces' })
  })

  it('goes to the index when the stored entry is the index', () => {
    expect(resolveSpacesHref({ spaceId: null }, ['a'])).toEqual({
      to: '/spaces',
    })
  })

  it('trusts a stored space while the list is still loading', () => {
    expect(resolveSpacesHref({ spaceId: 'a' }, undefined)).toEqual({
      to: '/space/$spaceId',
      params: { spaceId: 'a' },
    })
  })

  it('goes to the stored space when the list contains it', () => {
    expect(resolveSpacesHref({ spaceId: 'a' }, ['b', 'a'])).toEqual({
      to: '/space/$spaceId',
      params: { spaceId: 'a' },
    })
  })

  it('falls back to the index when the list no longer contains the space', () => {
    expect(resolveSpacesHref({ spaceId: 'a' }, ['b'])).toEqual({
      to: '/spaces',
    })
  })

  it('falls back to the index when the list is empty', () => {
    expect(resolveSpacesHref({ spaceId: 'a' }, [])).toEqual({ to: '/spaces' })
  })
})

describe('spacesEntryFor', () => {
  it('maps the index to a null space', () => {
    expect(spacesEntryFor('/spaces')).toEqual({ spaceId: null })
  })

  it('maps a space board to its id', () => {
    expect(spacesEntryFor('/space/abc')).toEqual({ spaceId: 'abc' })
  })

  it('ignores a trailing slash on a space board', () => {
    expect(spacesEntryFor('/space/abc/')).toEqual({ spaceId: 'abc' })
  })

  it('records nothing outside the spaces area', () => {
    expect(spacesEntryFor('/')).toBeNull()
    expect(spacesEntryFor('/timeline')).toBeNull()
    expect(spacesEntryFor('/space')).toBeNull()
    expect(spacesEntryFor('/join/CODE')).toBeNull()
  })
})

describe('readLastSpaces and writeLastSpaces', () => {
  it('returns null when nothing has been written', () => {
    stubLocalStorage()
    expect(readLastSpaces()).toBeNull()
  })

  it('round-trips a space id and the index', () => {
    stubLocalStorage()
    writeLastSpaces({ spaceId: 'abc' })
    expect(readLastSpaces()).toEqual({ spaceId: 'abc' })
    writeLastSpaces({ spaceId: null })
    expect(readLastSpaces()).toEqual({ spaceId: null })
  })

  it('returns null for corrupt JSON', () => {
    stubLocalStorage({ 'lifeos.spaces.last': '{not json' })
    expect(readLastSpaces()).toBeNull()
  })

  it('returns null for a value with the wrong shape', () => {
    stubLocalStorage({ 'lifeos.spaces.last': '{"spaceId":5}' })
    expect(readLastSpaces()).toBeNull()
  })

  it('does not throw when storage refuses the write', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      },
    })
    expect(() => writeLastSpaces({ spaceId: 'abc' })).not.toThrow()
  })
})
