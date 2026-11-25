import { describe, expect, it } from 'vitest'

import { boardScope } from './board-scope'

describe('boardScope', () => {
  it('gives the personal board focus and calendar, not sharing tools', () => {
    expect(boardScope(null)).toEqual({
      spaceId: null,
      can: {
        focus: true,
        calendar: true,
        importEvents: true,
        assign: false,
        history: false,
      },
    })
  })

  it('gives a space board sharing tools, not focus or calendar', () => {
    expect(boardScope('s1')).toEqual({
      spaceId: 's1',
      can: {
        focus: false,
        calendar: false,
        importEvents: false,
        assign: true,
        history: true,
      },
    })
  })
})
