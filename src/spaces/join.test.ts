import { describe, expect, it, vi } from 'vitest'

import { joinFailure, joinOnce, joinOutcome } from './join'

import type { JoinFn } from './join'

const space = {
  id: 's1',
  ownerId: 'u1',
  name: 'Trip',
  inviteCode: 'K7M4PQX2RT',
  createdAt: 1,
}

describe('joinOutcome', () => {
  it('reports a first join and a repeat join apart', () => {
    expect(joinOutcome({ ok: true, space, alreadyMember: false })).toEqual({
      kind: 'joined',
      spaceId: 's1',
      name: 'Trip',
      alreadyMember: false,
    })
    expect(joinOutcome({ ok: true, space, alreadyMember: true })).toMatchObject(
      { alreadyMember: true },
    )
  })

  it('names each refusal', () => {
    expect(joinOutcome({ ok: false, reason: 'invalid' })).toEqual({
      kind: 'failed',
      message: 'That invite code is not a valid code.',
    })
    expect(joinOutcome({ ok: false, reason: 'not_found' })).toEqual({
      kind: 'failed',
      message: 'No space matches that invite code.',
    })
    expect(
      joinOutcome({ ok: false, reason: 'throttled', retryAfterMinutes: 12 }),
    ).toEqual({
      kind: 'failed',
      message: 'Too many attempts. Try again in 12 minutes.',
    })
    expect(joinOutcome({ ok: false, reason: 'throttled' })).toEqual({
      kind: 'failed',
      message: 'Too many attempts. Try again in 5 minutes.',
    })
  })
})

describe('joinFailure', () => {
  it('keeps the server message and falls back for anything else', () => {
    expect(joinFailure(new Error('Not signed in'))).toEqual({
      kind: 'failed',
      message: 'Not signed in',
    })
    expect(joinFailure('boom')).toEqual({
      kind: 'failed',
      message: 'Failed to join',
    })
  })
})

describe('joinOnce', () => {
  it('shares one request while the same code is in flight', async () => {
    const join = vi.fn<JoinFn>(async () => ({
      ok: true,
      space,
      alreadyMember: false,
    }))
    const [first, second] = await Promise.all([
      joinOnce(join, 'K7M4PQX2RT'),
      joinOnce(join, 'K7M4PQX2RT'),
    ])
    expect(join).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
  })

  it('asks again once the last request settles', async () => {
    const join = vi.fn<JoinFn>(async () => ({ ok: false, reason: 'not_found' }))
    await joinOnce(join, 'K7M4PQX2RT')
    await expect(joinOnce(join, 'K7M4PQX2RT')).resolves.toEqual({
      ok: false,
      reason: 'not_found',
    })
    expect(join).toHaveBeenCalledTimes(2)
  })

  it('keeps different codes apart', async () => {
    const join = vi.fn<JoinFn>(async () => ({ ok: false, reason: 'invalid' }))
    await Promise.all([
      joinOnce(join, 'AAAAAAAAAA'),
      joinOnce(join, 'BBBBBBBBBB'),
    ])
    expect(join).toHaveBeenCalledTimes(2)
  })

  it('lets a failed request be retried', async () => {
    const join = vi
      .fn<JoinFn>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, space, alreadyMember: false })
    await expect(joinOnce(join, 'K7M4PQX2RT')).rejects.toThrow('offline')
    await expect(joinOnce(join, 'K7M4PQX2RT')).resolves.toMatchObject({
      ok: true,
    })
  })
})
