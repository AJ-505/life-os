import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Copy, Link2, Lock, ShieldOff, Users } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '#/design-system/ui/badge'
import { Button } from '#/design-system/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/design-system/ui/dialog'
import { Input } from '#/design-system/ui/input'
import { Label } from '#/design-system/ui/label'
import { Separator } from '#/design-system/ui/separator'
import {
  mySpacesQueryOptions,
  useRemoveMember,
  useResetInviteCode,
  useSpaceMembers,
} from '#/spaces/queries'

type Member = {
  userId: string
  role: string
  joinedAt: number
  isSelf: boolean
}

/** Clerk user ids are long and ugly. These two helpers are the whole story of
 *  how a member is shown until names are resolved, which is a named follow-up
 *  rather than something to invent here. */
export function shortMemberId(userId: string): string {
  const tail = userId.split('_').pop() ?? userId
  return tail.slice(0, 8)
}

export function memberInitials(userId: string): string {
  return shortMemberId(userId).slice(0, 2).toUpperCase()
}

/**
 * Share and membership for one space.
 *
 * The invite code is read from the live spaces query rather than passed in, so
 * a reset shows the new code here and on the card at the same time instead of
 * showing a stale one in one place.
 *
 * The owner gets two controls, and they are one behaviour each:
 * - Reset the link rotates the code for the whole space.
 * - Remove takes one person's access away and rotates the code in the same
 *   transaction, because either half alone leaves a way back in.
 */
export function SpacesShareDialog({
  open,
  onClose,
  spaceId,
}: {
  open: boolean
  onClose: () => void
  spaceId: string
}) {
  const [copied, setCopied] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [removing, setRemoving] = useState<Member | null>(null)

  const { data: spaces } = useQuery({ ...mySpacesQueryOptions, retry: false })
  const members = useSpaceMembers(open ? spaceId : null)
  const resetInviteCode = useResetInviteCode()
  const removeMember = useRemoveMember()

  const space = spaces?.find((s) => s.id === spaceId) ?? null
  const inviteCode = space?.inviteCode ?? ''
  const list: Array<Member> = members ?? []
  const isOwner = list.some((m) => m.isSelf && m.role === 'owner')
  const inviteLink = `${typeof window !== 'undefined' ? window.location.origin : ''}/join/${inviteCode}`
  const label = (m: Member) => (m.isSelf ? 'You' : shortMemberId(m.userId))

  const copy = async (text: string, msg: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    toast.success(msg)
    setTimeout(() => setCopied(false), 1500)
  }

  const doReset = () => {
    resetInviteCode.mutate(
      { spaceId },
      {
        onSuccess: ({ inviteCode: next }) => {
          setConfirmReset(false)
          toast.success('New link ready', {
            description: `The old link no longer works. New code: ${next}`,
          })
        },
        onError: (e: unknown) => {
          toast.error('Could not reset the link', {
            description: e instanceof Error ? e.message : String(e),
          })
        },
      },
    )
  }

  const doRemove = () => {
    if (!removing) return
    const target = removing
    removeMember.mutate(
      { spaceId, userId: target.userId },
      {
        onSuccess: () => {
          setRemoving(null)
          toast.success(`${label(target)} removed`, {
            description:
              'The invite link changed, so the link they hold no longer works.',
          })
        },
        onError: (e: unknown) => {
          toast.error('Could not remove them', {
            description: e instanceof Error ? e.message : String(e),
          })
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4 text-signal" /> Share “
            {space?.name ?? 'this space'}”
          </DialogTitle>
          <DialogDescription>
            Anyone with the link can join — no paywall, unlimited members.
            Leaving removes your access but does not invalidate the link, so
            reset it if you need the old one dead.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label className="os-label">Invite link</Label>
              {isOwner ? (
                <Button
                  variant="ghost"
                  size="xs"
                  className="gap-1 text-muted-foreground"
                  onClick={() => setConfirmReset(true)}
                >
                  <ShieldOff className="size-3" /> Reset link
                </Button>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Input
                readOnly
                value={inviteLink}
                className="font-mono text-xs"
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={!inviteCode}
                onClick={() => copy(inviteLink, 'Link copied')}
                className="shrink-0 gap-1.5"
              >
                {copied ? (
                  <Check className="size-3.5" />
                ) : (
                  <Copy className="size-3.5" />
                )}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1 font-mono text-[10px]">
                <Link2 className="size-3" /> {inviteCode || '—'}
              </Badge>
              <Button
                variant="ghost"
                size="xs"
                disabled={!inviteCode}
                onClick={() => copy(inviteCode, 'Code copied')}
              >
                Copy code
              </Button>
            </div>
          </div>

          {confirmReset ? (
            <div className="flex flex-col rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <p className="mb-2 text-xs leading-snug">
                The old link stops working for anyone who has not joined yet.
                Everyone already in the space stays in.
              </p>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={resetInviteCode.isPending}
                  onClick={doReset}
                >
                  {resetInviteCode.isPending ? 'Resetting…' : 'Reset the link'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmReset(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          {removing ? (
            <div className="flex flex-col rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <p className="mb-2 text-xs leading-snug">
                Remove {label(removing)}? They lose access immediately, and the
                invite link changes so the link they hold stops working. Their
                projects and tasks stay in the space.
              </p>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={removeMember.isPending}
                  onClick={doRemove}
                >
                  {removeMember.isPending ? 'Removing…' : 'Remove member'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setRemoving(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          <Separator />

          <div className="flex flex-col gap-2">
            <Label className="os-label">
              {list.length === 0 ? 'Members' : `Members · ${list.length}`}
            </Label>
            {list.length === 0 ? (
              <p className="text-xs text-muted-foreground">Loading members…</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {list.map((m) => (
                  <div
                    key={m.userId}
                    className="flex items-center gap-2 rounded-md border px-2.5 py-2"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-signal text-[11px] font-bold text-signal-foreground">
                      {memberInitials(m.userId)}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">
                      {label(m)}
                    </span>
                    {m.role === 'owner' ? (
                      <Badge className="gap-1 text-[10px] capitalize">
                        <Lock className="size-2.5" /> owner
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-[10px] capitalize"
                      >
                        {m.role}
                      </Badge>
                    )}
                    {isOwner && !m.isSelf && m.role !== 'owner' ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          setConfirmReset(false)
                          setRemoving(m)
                        }}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
