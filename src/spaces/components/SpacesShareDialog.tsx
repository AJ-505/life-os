import { useState } from 'react'
import { Check, Copy, Link2, Users } from 'lucide-react'
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
import { useSpaceMembers } from '#/spaces/queries'

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

export function SpacesShareDialog({
  open,
  onClose,
  spaceId,
  spaceName,
  inviteCode,
}: {
  open: boolean
  onClose: () => void
  spaceId: string
  spaceName: string
  inviteCode: string
}) {
  const [copied, setCopied] = useState(false)
  const members = useSpaceMembers(open ? spaceId : null)
  const inviteLink = `${typeof window !== 'undefined' ? window.location.origin : ''}/join/${inviteCode}`

  const copy = async (text: string, msg: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    toast.success(msg)
    setTimeout(() => setCopied(false), 1500)
  }

  const list: Array<Member> = members ?? []

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4 text-signal" /> Share “{spaceName}”
          </DialogTitle>
          <DialogDescription>
            Anyone with the link can join — no paywall, unlimited members.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="os-label">Invite link</Label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={inviteLink}
                className="font-mono text-xs"
              />
              <Button
                size="sm"
                variant="secondary"
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
                <Link2 className="size-3" /> {inviteCode}
              </Badge>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => copy(inviteCode, 'Code copied')}
              >
                Copy code
              </Button>
            </div>
          </div>

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
                      {m.isSelf ? 'You' : shortMemberId(m.userId)}
                    </span>
                    <Badge
                      variant={m.role === 'owner' ? 'default' : 'outline'}
                      className="text-[10px] capitalize"
                    >
                      {m.role}
                    </Badge>
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
