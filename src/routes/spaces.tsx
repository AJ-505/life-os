import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Copy, Link2, MoreHorizontal, Plus, Users, Zap } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '#/design-system/ui/button'
import { ComingSoon } from '#/design-system'
import { SPACES_ENABLED } from '#/feature-flags'
import { Badge } from '#/design-system/ui/badge'
import { Input } from '#/design-system/ui/input'
import { Label } from '#/design-system/ui/label'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '#/design-system/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/design-system/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/design-system/ui/dropdown-menu'
import {
  mySpacesQueryOptions,
  useCreateSpace,
  useDeleteSpace,
  useLeaveSpace,
} from '#/spaces/queries'
import { SpacesShareDialog } from '#/spaces/components/SpacesShareDialog'

export const Route = createFileRoute('/spaces')({
  component: SpacesView,
})

type SpaceRow = {
  id: string
  name: string
  inviteCode: string
  ownerId: string
  createdAt: number
  role: 'owner' | 'member'
}

function SpacesView() {
  const createSpace = useCreateSpace()
  const leaveSpace = useLeaveSpace()
  const deleteSpace = useDeleteSpace()
  const navigate = useNavigate()

  const [newOpen, setNewOpen] = useState(false)
  const [name, setName] = useState('')
  const [shareSpace, setShareSpace] = useState<SpaceRow | null>(null)
  const [confirm, setConfirm] = useState<{
    space: SpaceRow
    kind: 'leave' | 'delete'
  } | null>(null)

  const { data: spaces = [] } = useQuery({
    ...mySpacesQueryOptions,
    retry: false,
    enabled: SPACES_ENABLED,
  })

  const handleCreate = () => {
    const n = name.trim()
    if (!n) return
    createSpace.mutate(
      { name: n },
      {
        onSuccess: (space) => {
          setName('')
          setNewOpen(false)
          toast.success(`Space “${n}” created`)
          void navigate({
            to: '/space/$spaceId',
            params: { spaceId: space.id },
          })
        },
        onError: (e: unknown) => {
          toast.error('Could not create the space', {
            description: e instanceof Error ? e.message : String(e),
          })
        },
      },
    )
  }

  const copy = async (code: string) => {
    const link = `${window.location.origin}/join/${code}`
    await navigator.clipboard.writeText(link)
    toast.success('Link copied')
  }

  const runConfirm = () => {
    if (!confirm) return
    const { space, kind } = confirm
    const done = () => {
      setConfirm(null)
      toast.success(kind === 'leave' ? 'You left the space' : 'Space deleted')
    }
    const failed = (e: unknown) =>
      toast.error(kind === 'leave' ? 'Could not leave' : 'Could not delete', {
        description: e instanceof Error ? e.message : String(e),
      })
    if (kind === 'leave')
      leaveSpace.mutate(
        { spaceId: space.id },
        { onSuccess: done, onError: failed },
      )
    else
      deleteSpace.mutate(
        { spaceId: space.id },
        { onSuccess: done, onError: failed },
      )
  }

  // Gated behind SPACES_ENABLED. The query above is disabled rather than
  // merely hidden, so a gated build makes no spaces read at all.
  if (!SPACES_ENABLED) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
          <h1 className="text-lg font-bold tracking-tight">Spaces</h1>
        </div>
        <div className="board-scroll min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-3xl">
            <ComingSoon
              title="Spaces"
              description="Collaborative boards you share with others."
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-bold tracking-tight">Spaces</h1>
          <span className="os-label hidden sm:inline">
            {spaces.length} spaces · collaborative boards
          </span>
        </div>
        <Button
          size="sm"
          className="gap-1.5 bg-signal text-signal-foreground hover:bg-signal/90"
          onClick={() => setNewOpen(true)}
        >
          <Plus className="size-4" /> New Space
        </Button>
      </div>

      <div className="board-scroll min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          {spaces.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
              <Users className="size-6 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                No spaces yet. Create one to collaborate.
              </p>
              <Button size="sm" onClick={() => setNewOpen(true)}>
                <Plus className="size-4" /> New Space
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {spaces.map((s) => (
                <Card key={s.id} className="flex flex-col">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Users className="size-4 text-signal" /> {s.name}
                      <span className="ml-auto flex items-center gap-1">
                        <Badge
                          variant="outline"
                          className="text-[10px] capitalize"
                        >
                          {s.role}
                        </Badge>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 text-muted-foreground"
                              aria-label={`Actions for ${s.name}`}
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() =>
                                setConfirm({ space: s, kind: 'leave' })
                              }
                            >
                              Leave space
                            </DropdownMenuItem>
                            {s.role === 'owner' ? (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={() =>
                                    setConfirm({ space: s, kind: 'delete' })
                                  }
                                >
                                  Delete space
                                </DropdownMenuItem>
                              </>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </span>
                    </CardTitle>
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className="gap-1 font-mono text-[10px]"
                      >
                        <Link2 className="size-3" />
                        {s.inviteCode}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 pt-0">
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 gap-1.5"
                        onClick={() => copy(s.inviteCode)}
                      >
                        <Copy className="size-3.5" /> Copy link
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setShareSpace(s)}
                      >
                        Share
                      </Button>
                    </div>
                    <Link
                      to="/space/$spaceId"
                      params={{ spaceId: s.id }}
                      className="no-underline"
                    >
                      <Button
                        size="sm"
                        className="w-full bg-signal text-signal-foreground hover:bg-signal/90"
                      >
                        Enter Space →
                      </Button>
                    </Link>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Zap className="size-3 text-signal" /> Live sync
                      <span className="ml-auto font-mono text-[10px]">
                        {new Date(s.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={newOpen} onOpenChange={(o) => !o && setNewOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="size-4 text-signal" /> New Space
            </DialogTitle>
            <DialogDescription>
              Create a collaborative board. Share the link — anyone can join.
              Life OS generates the invite code for you.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label className="os-label">Space name</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="e.g. Design Sprint, Family Trip"
            />
          </div>
          <DialogFooter>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!name.trim() || createSpace.isPending}
            >
              {createSpace.isPending ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {confirm?.kind === 'delete'
                ? 'Delete this space?'
                : 'Leave this space?'}
            </DialogTitle>
            <DialogDescription>
              {confirm?.kind === 'delete'
                ? `“${confirm.space.name}” and every project and task in it will be deleted for everyone. This cannot be undone.`
                : confirm
                  ? confirm.space.role === 'owner'
                    ? `You own “${confirm.space.name}”. Leaving hands it to the longest-standing member and changes the invite code.`
                    : `You will lose access to “${confirm.space.name}”. You can rejoin with an invite link.`
                  : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              size="sm"
              variant={confirm?.kind === 'delete' ? 'destructive' : 'default'}
              onClick={runConfirm}
              disabled={leaveSpace.isPending || deleteSpace.isPending}
            >
              {confirm?.kind === 'delete' ? 'Delete space' : 'Leave space'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {shareSpace ? (
        <SpacesShareDialog
          open={shareSpace !== null}
          onClose={() => setShareSpace(null)}
          spaceId={shareSpace.id}
          spaceName={shareSpace.name}
          inviteCode={shareSpace.inviteCode}
        />
      ) : null}
    </div>
  )
}
