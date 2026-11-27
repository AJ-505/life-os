import { describe, expect, it } from 'vitest'

import { PROJECT_COLORS, freshColor } from './types'

describe('freshColor', () => {
  it('starts at the first colour of the palette', () => {
    expect(freshColor([])).toBe('flame')
  })

  it('skips colours in use, so a delete never brings back a duplicate', () => {
    expect(freshColor(['saffron'])).toBe('flame')
    expect(freshColor(['flame', 'saffron', 'sea'])).toBe('moss')
  })

  it('spreads colours evenly once the palette is used up', () => {
    const all = [...PROJECT_COLORS, 'flame', 'moss']
    expect(freshColor(all)).toBe('saffron')
  })
})
