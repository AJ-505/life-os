import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Dialog, DialogContent, DialogTitle } from './dialog'

function openDialog(className: string) {
  render(
    createElement(
      Dialog,
      { open: true },
      createElement(
        DialogContent,
        { className, 'aria-describedby': undefined },
        createElement(DialogTitle, null, 'Edit goal'),
      ),
    ),
  )
  return screen.getByRole('dialog')
}

describe('DialogContent', () => {
  afterEach(cleanup)

  it.each(['max-w-sm', 'max-w-md', ''])(
    'keeps a margin from the screen edge with "%s"',
    (className) => {
      const classes = openDialog(className).className.split(' ')
      expect(classes).toContain('w-[calc(100%-2rem)]')
      expect(classes).not.toContain('w-full')
    },
  )
})
