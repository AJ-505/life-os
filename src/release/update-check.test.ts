import { describe, expect, it } from 'vitest'

import { isUpdateAvailable } from './update-check'

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
