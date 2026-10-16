import { describe, expect, it } from 'vitest'

import { GO_LIVE_MS, isUpdateAvailable, msUntilLive } from './update-check'

describe('isUpdateAvailable', () => {
  it('stays quiet when the running build is the published one', () => {
    expect(isUpdateAvailable('abc', 'abc', null)).toBe(false)
  })

  it('fires when the published build differs', () => {
    expect(isUpdateAvailable('abc', 'def', null)).toBe(true)
  })

  it('stays quiet in builds without an id, such as dev and previews', () => {
    expect(isUpdateAvailable('', 'def', null)).toBe(false)
  })

  it('stays quiet until the server has answered or published', () => {
    expect(isUpdateAvailable('abc', undefined, null)).toBe(false)
    expect(isUpdateAvailable('abc', null, null)).toBe(false)
  })

  it('does not nag again for a release the user already saw', () => {
    expect(isUpdateAvailable('abc', 'def', 'def')).toBe(false)
    expect(isUpdateAvailable('abc', 'ghi', 'def')).toBe(true)
  })
})

describe('msUntilLive', () => {
  it('waits the go-live window after a fresh publish', () => {
    expect(msUntilLive(1_000, 1_000)).toBe(GO_LIVE_MS)
  })

  it('is zero once the window has passed', () => {
    expect(msUntilLive(1_000, 1_000 + GO_LIVE_MS + 5)).toBe(0)
  })
})
