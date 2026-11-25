import { useEffect, useState } from 'react'

import type { FunctionReturnType } from 'convex/server'

import type { api } from '../../convex/_generated/api'

type JoinResult = FunctionReturnType<typeof api.spaces.joinSpaceByCode>

export type JoinFn = (args: { inviteCode: string }) => Promise<JoinResult>

export type JoinOutcome =
  | { kind: 'joined'; spaceId: string; name: string; alreadyMember: boolean }
  | { kind: 'failed'; message: string }

const FALLBACK_WAIT_MINUTES = 5

function failureMessage(result: Extract<JoinResult, { ok: false }>): string {
  if (result.reason === 'throttled')
    return `Too many attempts. Try again in ${result.retryAfterMinutes ?? FALLBACK_WAIT_MINUTES} minutes.`
  if (result.reason === 'invalid')
    return 'That invite code is not a valid code.'
  return 'No space matches that invite code.'
}

export function joinOutcome(result: JoinResult): JoinOutcome {
  if (!result.ok) return { kind: 'failed', message: failureMessage(result) }
  return {
    kind: 'joined',
    spaceId: result.space.id,
    name: result.space.name,
    alreadyMember: result.alreadyMember,
  }
}

export function joinFailure(error: unknown): JoinOutcome {
  return {
    kind: 'failed',
    message: error instanceof Error ? error.message : 'Failed to join',
  }
}

const pendingJoins = new Map<string, Promise<JoinResult>>()

export function joinOnce(
  join: JoinFn,
  inviteCode: string,
): Promise<JoinResult> {
  const pending =
    pendingJoins.get(inviteCode) ??
    join({ inviteCode }).finally(() => pendingJoins.delete(inviteCode))
  pendingJoins.set(inviteCode, pending)
  return pending
}

export function useJoinSpace(
  inviteCode: string,
  join: JoinFn,
  enabled: boolean,
): JoinOutcome | null {
  const [settled, setSettled] = useState<{
    inviteCode: string
    outcome: JoinOutcome
  } | null>(null)

  useEffect(() => {
    if (!enabled) return
    let live = true
    joinOnce(join, inviteCode)
      .then(joinOutcome, joinFailure)
      .then((outcome) => {
        if (live) setSettled({ inviteCode, outcome })
      })
    return () => {
      live = false
    }
  }, [enabled, inviteCode, join])

  return settled?.inviteCode === inviteCode ? settled.outcome : null
}
