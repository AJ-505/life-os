import { StrictMode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useJoinSpace } from './join'

import type { JoinFn } from './join'

const space = {
  id: 's1',
  ownerId: 'u1',
  name: 'Trip',
  inviteCode: 'K7M4PQX2RT',
  createdAt: 1,
}

const joined = vi.fn<JoinFn>(async () => ({
  ok: true,
  space,
  alreadyMember: false,
}))

describe('useJoinSpace', () => {
  it('joins once when effects run twice, so a first join never reads as a repeat', async () => {
    joined.mockClear()
    const { result } = renderHook(
      () => useJoinSpace('K7M4PQX2RT', joined, true),
      { wrapper: StrictMode },
    )
    expect(result.current).toBeNull()
    await waitFor(() =>
      expect(result.current).toEqual({
        kind: 'joined',
        spaceId: 's1',
        name: 'Trip',
        alreadyMember: false,
      }),
    )
    expect(joined).toHaveBeenCalledTimes(1)
  })

  it('drops the old outcome when the invite code changes', async () => {
    joined.mockClear()
    const { result, rerender } = renderHook(
      ({ code }) => useJoinSpace(code, joined, true),
      { initialProps: { code: 'K7M4PQX2RT' } },
    )
    await waitFor(() => expect(result.current).not.toBeNull())
    rerender({ code: 'AAAAAAAAAA' })
    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(joined).toHaveBeenCalledTimes(2)
  })

  it('stays idle while spaces are off', async () => {
    const join = vi.fn<JoinFn>()
    const { result } = renderHook(() => useJoinSpace('K7M4PQX2RT', join, false))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(join).not.toHaveBeenCalled()
    expect(result.current).toBeNull()
  })

  it('shows a thrown server error', async () => {
    const join = vi.fn<JoinFn>(async () => {
      throw new Error('Not signed in')
    })
    const { result } = renderHook(() => useJoinSpace('K7M4PQX2RT', join, true))
    await waitFor(() =>
      expect(result.current).toEqual({
        kind: 'failed',
        message: 'Not signed in',
      }),
    )
    expect(join).toHaveBeenCalledTimes(1)
  })
})
