import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Copy, Link2, Plus, Users, Zap } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '#/design-system/ui/button'
import { ComingSoon } from '#/design-system'
import { SPACES_ENABLED } from '#/feature-flags'
import { Badge } from '#/design-system/ui/badge'
import { Input } from '#/design-system/ui/input'
import { Label } from '#/design-system/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '#/design-system/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '#/design-system/ui/dialog'
import { newId } from '#/tracker/types'
import { mySpacesQueryOptions, useCreateSpace } from '#/spaces/queries'
import { localSpaces as localSpacesSchema } from '#/spaces/validation'
import { SpacesShareDialog } from '#/spaces/components/SpacesShareDialog'

export const Route = createFileRoute('/spaces')({
  component: SpacesView,
})

function SpacesView() {
  const createSpace = useCreateSpace()
  const [newOpen, setNewOpen] = useState(false)
  const [name, setName] = useState('')
  const [shareOpen, setShareOpen] = useState(false)
  const [activeSpace, setActiveSpace] = useState<{ id: string; name: string; inviteCode: string } | null>(null)

  const [localSpaces, setLocalSpaces] = useState<Array<{ id: string; name: string; inviteCode: string; createdAt: number }>>(() => {
    if (typeof window === 'undefined') return []
    try { const raw = localStorage.getItem('lifeos-local-spaces'); if (!raw) return []; const parsed = localSpacesSchema.safeParse(JSON.parse(raw)); return parsed.success ? parsed.data : [] } catch { return [] }
  })
  const { data: fetched } = useQuery({ ...mySpacesQueryOptions, retry: false })
  const spaces = fetched && fetched.length > 0 ? fetched : localSpaces

  const handleCreate = () => {
    const n = name.trim()
    if (!n) return
    const id = newId()
    const inviteCode = Math.random().toString(36).slice(2, 8).toUpperCase()
    const entry = { id, name: n, inviteCode, createdAt: Date.now() }
    const next = [...localSpaces, entry]
    setLocalSpaces(next)
    try { localStorage.setItem('lifeos-local-spaces', JSON.stringify(next)) } catch {}
    setName('')
    setNewOpen(false)
    toast.success(`Space “${n}” created`)
    createSpace.mutate({ id, name: n, inviteCode }, {
      onSuccess: (code) => {
        if (typeof code !== 'string' || code === inviteCode) return
        const upd = localSpaces.map(s => s.id === id ? { ...s, inviteCode: code } : s)
        setLocalSpaces(upd)
        try { localStorage.setItem('lifeos-local-spaces', JSON.stringify(upd)) } catch {}
      },
    })
  }

  const copy = async (code: string) => {
    const link = `${window.location.origin}/join/${code}`
    await navigator.clipboard.writeText(link)
    toast.success('Link copied')
  }

  // Gated behind SPACES_ENABLED: the hooks above stay put so flipping the
  // flag restores the exact same behavior, but the page renders ComingSoon.
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
          <span className="os-label hidden sm:inline">{spaces.length} spaces · collaborative boards</span>
        </div>
        <Button size="sm" className="gap-1.5 bg-signal text-signal-foreground hover:bg-signal/90" onClick={() => setNewOpen(true)}>
          <Plus className="size-4" /> New Space
        </Button>
      </div>

      <div className="board-scroll min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
{spaces.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
              <Users className="size-6 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No spaces yet. Create one to collaborate.</p>
              <Button size="sm" onClick={() => setNewOpen(true)}><Plus className="size-4" /> New Space</Button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {spaces.map(s => (
                <Card key={s.id} className="flex flex-col">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Users className="size-4 text-signal" /> {s.name}
                    </CardTitle>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="font-mono text-[10px] gap-1"><Link2 className="size-3" />{s.inviteCode}</Badge>
                      <span className="text-xs text-muted-foreground">· unlimited members</span>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 pt-0">
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" className="flex-1 gap-1.5" onClick={() => copy(s.inviteCode)}><Copy className="size-3.5" /> Copy link</Button>
                      <Button size="sm" variant="secondary" onClick={() => { setActiveSpace(s); setShareOpen(true) }}>Share</Button>
                    </div>
                    <Link to="/join/$inviteCode" params={{ inviteCode: s.inviteCode }} className="no-underline">
                      <Button size="sm" className="w-full bg-signal text-signal-foreground hover:bg-signal/90">Enter Space →</Button>
                    </Link>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Zap className="size-3 text-signal" /> Live sync
                      <span className="ml-auto font-mono text-[10px]">{new Date(s.createdAt).toLocaleDateString()}</span>
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
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Users className="size-4 text-signal" /> New Space</DialogTitle><DialogDescription>Create a collaborative board. Share the link — anyone can join.</DialogDescription></DialogHeader>
          <div className="flex flex-col gap-1.5"><Label className="os-label">Space name</Label><Input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreate()} placeholder="e.g. Design Sprint, Family Trip" /></div>
          <DialogFooter><Button size="sm" onClick={handleCreate} disabled={!name.trim() || createSpace.isPending}>{createSpace.isPending ? 'Creating…' : 'Create'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {activeSpace ? <SpacesShareDialog open={shareOpen} onClose={() => setShareOpen(false)} spaceName={activeSpace.name} inviteCode={activeSpace.inviteCode} /> : null}
    </div>
  )
}
