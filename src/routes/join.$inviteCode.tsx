import { useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Check, Loader2, Users } from 'lucide-react'

import { Button } from '#/design-system/ui/button'
import { ComingSoon } from '#/design-system'
import { SPACES_ENABLED } from '#/feature-flags'
import { Badge } from '#/design-system/ui/badge'
import { useJoinSpace } from '#/spaces/queries'
import { joinResult as joinResultSchema, localSpaces as localSpacesSchema } from '#/spaces/validation'

export const Route = createFileRoute('/join/$inviteCode')({
  component: JoinComponent,
})

function JoinComponent() {
  const { inviteCode } = Route.useParams()
  const join = useJoinSpace()
  const [phase, setPhase] = useState<'idle' | 'loading' | 'success' | 'error'>(
    'idle',
  )
  // @ts-ignore temp
  const [result, setResult] = useState<{
    spaceId: string
    name: string
    alreadyMember?: boolean
  } | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    // Gated: never fire the join mutation while Spaces is off.
    if (!SPACES_ENABLED) return
    if (!inviteCode || phase !== 'idle') return
    setPhase('loading')
    join.mutate(
      { inviteCode },
      {
        onSuccess: (data: unknown) => {
          const parsedJoin = joinResultSchema.safeParse(data)
          const spaceId = parsedJoin.success
            ? (parsedJoin.data.id ?? parsedJoin.data.spaceId)
            : undefined
          if (!parsedJoin.success || !spaceId) {
            setErrorMsg('Failed to join')
            setPhase('error')
            return
          }
          const name = parsedJoin.data.name
          // Persist locally so Spaces selector shows it even before Convex sync (fallback path)
          try {
            const raw = localStorage.getItem('lifeos-local-spaces')
            const parsedLocal = localSpacesSchema.safeParse(raw ? JSON.parse(raw) : [])
            const arr: Array<{
              id: string
              name: string
              inviteCode: string
              createdAt: number
            }> = parsedLocal.success ? parsedLocal.data : []
            if (!arr.some((s) => s.id === spaceId)) {
              arr.push({
                id: spaceId,
                name,
                inviteCode: inviteCode.toUpperCase(),
                createdAt: Date.now(),
              })
              localStorage.setItem('lifeos-local-spaces', JSON.stringify(arr))
            }
            localStorage.setItem('lifeos-selected-space', spaceId)
          } catch {}
          setResult({ spaceId, name })
          setPhase('success')
        },
        onError: (e: unknown) => {
          const msg =
            e instanceof Error
              ? e.message
              : typeof e === 'string'
                ? e
                : 'Failed to join'
          setErrorMsg(msg)
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
              <span className="size-1.5 rounded-full bg-signal animate-pulse" />{' '}
              Live sync via Convex
            </Badge>
          </div>
        ) : phase === 'success' && result ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 rounded-lg bg-signal/10 px-3 py-2.5">
              <Check className="size-5 text-signal" />
              <div className="flex flex-col">
                <span className="text-sm font-semibold">
                  Joined “{result.name}”
                </span>
                <span className="text-xs text-muted-foreground">
                  {result.alreadyMember
                    ? 'You were already a member - welcome back.'
                    : 'Anyone with link can join'}
                </span>
              </div>
            </div>
            <Link to="/" className="no-underline">
              <Button className="w-full bg-signal text-signal-foreground hover:bg-signal/90">
                Go to board
              </Button>
            </Link>
            <Link to="/" className="no-underline">
              <Button variant="outline" className="w-full">
                View Space board
              </Button>
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              {errorMsg ?? 'Invalid invite code.'}
            </p>
            <p className="text-xs text-muted-foreground">
              Ask the owner for a fresh link. Codes are 6 characters (e.g.
              AB12CD).
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
