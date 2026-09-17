import { useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Check, Loader2, Users } from 'lucide-react'

import { Button } from '#/design-system/ui/button'
import { ComingSoon } from '#/design-system'
import { SPACES_ENABLED } from '#/feature-flags'
import { Badge } from '#/design-system/ui/badge'
import { useJoinSpace } from '#/spaces/queries'
import { joinResult as joinResultSchema } from '#/spaces/validation'

export const Route = createFileRoute('/join/$inviteCode')({
  component: JoinComponent,
})

type Joined = { spaceId: string; name: string; alreadyMember: boolean }

function JoinComponent() {
  const { inviteCode } = Route.useParams()
  const join = useJoinSpace()
  const [phase, setPhase] = useState<'idle' | 'loading' | 'success' | 'error'>(
    'idle',
  )
  const [joined, setJoined] = useState<Joined | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    // Gated: never fire the join mutation while Spaces is off.
    if (!SPACES_ENABLED) return
    if (!inviteCode || phase !== 'idle') return
    setPhase('loading')
    join.mutate(
      { inviteCode },
      {
        onSuccess: (raw: unknown) => {
          // The mutation answers with a closed union rather than throwing for
          // the cases a user can act on, so this is a shape check, not a guess.
          const parsed = joinResultSchema.safeParse(raw)
          if (!parsed.success) {
            setErrorMsg('That invite link is not valid.')
            setPhase('error')
            return
          }
          if (!parsed.data.ok) {
            setErrorMsg(
              parsed.data.reason === 'throttled'
                ? `Too many attempts. Try again in ${parsed.data.retryAfterMinutes ?? 5} minutes.`
                : parsed.data.reason === 'invalid'
                  ? 'That invite code is not a valid code.'
                  : 'No space matches that invite code.',
            )
            setPhase('error')
            return
          }
          setJoined({
            spaceId: parsed.data.space.id,
            name: parsed.data.space.name,
            alreadyMember: parsed.data.alreadyMember,
          })
          setPhase('success')
        },
        onError: (e: unknown) => {
          setErrorMsg(e instanceof Error ? e.message : 'Failed to join')
          setPhase('error')
        },
      },
    )
    // phase and join listed so no suppression comment opts this effect out
    // of the compiler. Re-runs are guarded by phase above and no-op.
  }, [inviteCode, phase, join])

  if (!SPACES_ENABLED) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <ComingSoon
            title="Spaces"
            description="Collaborative boards you share with others."
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Users className="size-5 text-signal" />
          <h1 className="text-lg font-bold">Join Space</h1>
          <Badge variant="outline" className="ml-auto font-mono text-xs">
            {inviteCode.toUpperCase()}
          </Badge>
        </div>

        {phase === 'loading' || phase === 'idle' ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <Loader2 className="size-6 animate-spin text-signal" />
            <p className="text-sm text-muted-foreground">
              Joining “{inviteCode.toUpperCase()}”…
            </p>
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <span className="size-1.5 animate-pulse rounded-full bg-signal" />{' '}
              Live sync via Convex
            </Badge>
          </div>
        ) : phase === 'success' && joined ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 rounded-lg bg-signal/10 px-3 py-2.5">
              <Check className="size-5 text-signal" />
              <div className="flex flex-col">
                <span className="text-sm font-semibold">
                  Joined “{joined.name}”
                </span>
                <span className="text-xs text-muted-foreground">
                  {joined.alreadyMember
                    ? 'You were already a member - welcome back.'
                    : 'Anyone with the link can join'}
                </span>
              </div>
            </div>
            <Link
              to="/space/$spaceId"
              params={{ spaceId: joined.spaceId }}
              className="no-underline"
            >
              <Button className="w-full bg-signal text-signal-foreground hover:bg-signal/90">
                Open the shared board
              </Button>
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              {errorMsg ?? 'Invalid invite code.'}
            </p>
            <p className="text-xs text-muted-foreground">
              Ask the owner for a fresh link. Life OS codes are 10 characters
              such as K7M4PQX2RT.
            </p>
            <Link to="/" className="no-underline">
              <Button variant="outline" className="w-full">
                Back to board
              </Button>
            </Link>
          </div>
        )}
      </div>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        Life-OS Spaces · Trello destroyer — no paywalls, no limits, real-time
        Convex sync.
      </p>
    </div>
  )
}
