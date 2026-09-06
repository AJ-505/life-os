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

type Member = { userId: string; role: string; joinedAt: number }

function initials(nameOrId: string): string {
  const parts = nameOrId.split(/[\s@_-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2)
  return nameOrId.slice(0, 2).toUpperCase()
}

export function SpacesShareDialog({
  open,
  onClose,
  spaceName,
  inviteCode,
  members,
}: {
  open: boolean
  onClose: () => void
  spaceName: string
  inviteCode: string
  members?: Member[] | null
}) {
  const [copied, setCopied] = useState(false)
  const inviteLink = `${typeof window !== 'undefined' ? window.location.origin : ''}/join/${inviteCode}`

  const copy = async (text: string, msg: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    toast.success(msg)
    setTimeout(() => setCopied(false), 1500)
  }

  const mockMembers: Member[] =
    members && members.length > 0
      ? members
      : [{ userId: 'you', role: 'owner', joinedAt: Date.now() }]

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4 text-signal" /> Share “{spaceName}”
          </DialogTitle>
          <DialogDescription>Anyone with the link can join — no paywall, unlimited members.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Invite link */}
          <div className="flex flex-col gap-1.5">
            <Label className="os-label">Invite link</Label>
            <div className="flex gap-2">
              <Input readOnly value={inviteLink} className="font-mono text-xs" />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => copy(inviteLink, 'Link copied')}
                className="shrink-0 gap-1.5"
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-[10px] gap-1">
                <Link2 className="size-3" /> {inviteCode}
              </Badge>
              <Button variant="ghost" size="xs" onClick={() => copy(inviteCode, 'Code copied')}>
                Copy code
              </Button>
              <span className="text-xs text-muted-foreground">· Anyone with link can join</span>
            </div>
          </div>

          <Separator />

          {/* Members */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="os-label">Members · {mockMembers.length}</Label>
              <Badge variant="secondary" className="text-[10px]">Unlimited — no paywall</Badge>
            </div>
            <div className="flex flex-col gap-1.5">
              {mockMembers.map((m) => (
                <div key={m.userId} className="flex items-center gap-2 rounded-md border px-2.5 py-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-signal text-[11px] font-bold text-signal-foreground">
                    {initials(m.userId)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{m.userId}</span>
                  <Badge variant={m.role === 'owner' ? 'default' : 'outline'} className="text-[10px] capitalize">
                    {m.role}
                  </Badge>
                </div>
              ))}
            </div>
</div>
</div>
      </DialogContent>
    </Dialog>
  )
}
