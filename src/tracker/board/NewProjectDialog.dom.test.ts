import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NewProjectDialog } from './NewProjectDialog'

import type { CreateProjectArgs } from '../queries'

const mutate = vi.fn<(args: CreateProjectArgs) => void>()

vi.mock('../queries', () => ({
  useCreateProject: () => ({ mutate, isPending: true }),
}))

function dialog(open: boolean) {
  return createElement(NewProjectDialog, {
    open,
    onClose: () => {},
    gridCol: 0,
    board: [],
  })
}

function submitName(name: string) {
  const input = screen.getByPlaceholderText(/PAU Archive/)
  fireEvent.change(input, { target: { value: name } })
  fireEvent.keyDown(input, { key: 'Enter' })
  return input
}

describe('NewProjectDialog', () => {
  afterEach(() => {
    cleanup()
    mutate.mockClear()
  })

  it('creates the next project while the last one is still saving', () => {
    const view = render(dialog(true))
    submitName('Sem 2')
    view.rerender(dialog(false))
    view.rerender(dialog(true))
    submitName('Apartment hunt')

    const created = mutate.mock.calls.map(([args]) => [args.name, args.color])
    expect(created).toHaveLength(2)
    expect(created[0][0]).toBe('Sem 2')
    expect(created[1][0]).toBe('Apartment hunt')
    expect(created[1][1]).not.toBe(created[0][1])
  })

  it('creates one project when Enter is pressed twice', () => {
    render(dialog(true))
    const input = submitName('Sem 2')
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mutate).toHaveBeenCalledTimes(1)
  })
})
