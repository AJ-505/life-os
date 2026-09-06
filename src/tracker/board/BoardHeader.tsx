import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Crosshair, Link as LinkIcon, Plus, Users } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '#/design-system'
import { Button } from '#/design-system/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/design-system/ui/dialog'
import { Input } from '#/design-system/ui/input'
import { Label } from '#/design-system/ui/label'
import { Switch } from '#/design-system/ui/switch'

import { mySpacesQueryOptions, useCreateSpace } from '#/spaces/queries'
import { localSpaces } from '#/spaces/validation'
import { SpacesShareDialog } from '#/spaces/components/SpacesShareDialog'
import { SPACES_ENABLED } from '#/feature-flags'
import { newId } from '../types'

type LocalSpace = {
  id: string
  name: string
  inviteCode: string
  createdAt: number
}

// Module scope, not in the component: try/catch with value blocks opts a
// component out of React Compiler memoization, so all localStorage access
// lives here where the compiler doesn't look.
function readSelectedSpaceId(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('lifeos-selected-space') ?? ''
}

function readLocalSpaces(): Array<LocalSpace> {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem('lifeos-local-spaces')
    if (!raw) return []
    const parsed = localSpaces.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

function writeSelectedSpaceId(id: string) {
  try {
    localStorage.setItem('lifeos-selected-space', id)
  } catch {}
}

function writeLocalSpaces(spaces: Array<LocalSpace>) {
  try {
    localStorage.setItem('lifeos-local-spaces', JSON.stringify(spaces))
  } catch {}
}

/**
 * Board header + spaces. Owns ALL spaces state (selection, local fallback
 * cache, new-space dialog input, share dialog) so that typing a space name or
 * opening the dialogs never re-renders the board canvas.
 *
 * Previously this state lived in BoardView: every keystroke in the New Space
 * input re-rendered every column, card, and task row. Now only the header
 * re-renders. Memoized so board-root renders that don't touch its props
 * (e.g. drag start/end) skip it entirely.
 */
export function BoardHeader({
  activeCount,
  openCount,
  showDone,
  onShowDoneChange,
  defaultCol,
  onNewProject,
  focusOpen,
  onToggleFocus,
}: {
  activeCount: number
  openCount: number
  showDone: boolean
  onShowDoneChange: (v: boolean) => void
  defaultCol: number
  onNewProject: (col: number) => void
  focusOpen: boolean
  onToggleFocus: () => void
}) {
  const createSpace = useCreateSpace()
  const [newSpaceOpen, setNewSpaceOpen] = useState(false)
  const [newSpaceName, setNewSpaceName] = useState('')
  const [shareOpen, setShareOpen] = useState(false)
  const [selectedSpaceId, setSelectedSpaceId] =
    useState<string>(readSelectedSpaceId)
  const setSelected = (id: string) => {
    setSelectedSpaceId(id)
    writeSelectedSpaceId(id)
  }
  // Local fallback so UI works before Convex syncs / if backend not deployed yet
  const [localSpaces, setLocalSpaces] =
    useState<Array<LocalSpace>>(readLocalSpaces)
  const { data: fetchedSpaces } = useQuery({
    ...mySpacesQueryOptions,
    retry: false,
  })
  const spacesList: Array<{
    id: string
    name: string
    inviteCode: string
    createdAt: number
    memberCount?: number
  }> = fetchedSpaces && fetchedSpaces.length > 0 ? fetchedSpaces : localSpaces
  // Gated behind SPACES_ENABLED (see `#/feature-flags`): with the flag off
  // this is always null, so no spaces UI can render. State and queries stay
  // put so flipping the flag restores the exact same behavior.
  const selectedSpace = SPACES_ENABLED
    ? (spacesList.find((s) => s.id === selectedSpaceId) ?? null)
    : null

  const handleCreateSpace = () => {
    const name = newSpaceName.trim()
    if (!name) return
    const id = newId()
    const inviteCode = Math.random().toString(36).slice(2, 8).toUpperCase()
    const entry = {
      id,
      name,
      inviteCode,
      createdAt: Date.now(),
      memberCount: 1,
    }
    const next = [...localSpaces, entry]
    setLocalSpaces(next)
    writeLocalSpaces(next)
    setSelected(id)
    setNewSpaceName('')
    setNewSpaceOpen(false)
    toast.success(`Space “${name}” created`)
    createSpace.mutate(
      { id, name, inviteCode },
      {
        onSuccess: (code) => {
          if (typeof code !== 'string' || code === inviteCode) return
          const updated = localSpaces.map((s) =>
            s.id === id ? { ...s, inviteCode: code } : s,
          )
          setLocalSpaces(updated)
          writeLocalSpaces(updated)
        },
        onError: () => {},
      },
    )
  }
  const copyInviteLink = async () => {
    if (!selectedSpace) return
    const link = `${window.location.origin}/join/${selectedSpace.inviteCode}`
    await navigator.clipboard.writeText(link)
    toast.success('Link copied')
  }

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5 sm:px-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-2.5 sm:flex">
            <h1 className="text-lg font-bold leading-none tracking-tight">
              {selectedSpace ? selectedSpace.name : 'Board'}
            </h1>
            <span className="hidden text-sm leading-none text-muted-foreground lg:inline">
              {activeCount} projects · {openCount} open tasks
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          {selectedSpace ? (
            <>
              <div className="hidden items-center sm:flex">
                <div className="flex -space-x-1.5">
                  {(['You', 'Alex', 'Sam'] as const)
                    .slice(0, 3)
                    .map((n, i) => (
                      <span
                        key={n}
                        style={{ zIndex: 3 - i }}
                        className="flex size-6 items-center justify-center rounded-full border-2 border-background bg-signal text-[10px] font-bold text-signal-foreground"
                        title={n}
                      >
                        {n.slice(0, 1)}
                      </span>
                    ))}
                </div>
                <span className="ml-1.5 hidden text-[11px] text-muted-foreground lg:inline">
                  Unlimited members — no paywall
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                onClick={copyInviteLink}
              >
                <LinkIcon className="size-3.5" /> Share
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-8 gap-1"
                onClick={() => setShareOpen(true)}
              >
                <Users className="size-3.5" /> Members
              </Button>
            </>
          ) : null}
          <label className="flex cursor-pointer items-center gap-1.5">
            <Switch
              checked={showDone}
              onCheckedChange={onShowDoneChange}
              aria-label="Show completed tasks"
            />
            <span className="os-label hidden sm:inline">Done</span>
          </label>
          <Button
            size="sm"
            className="gap-1.5 bg-signal text-signal-foreground hover:bg-signal/90"
            onClick={() => onNewProject(defaultCol)}
          >
            <Plus className="size-4" /> Project
          </Button>
          <Button
            variant={focusOpen ? 'secondary' : 'ghost'}
            size="icon"
            className="hidden lg:inline-flex"
            aria-label="Toggle focus panel (])"
            title="Toggle focus panel  ]"
            onClick={onToggleFocus}
          >
            <Crosshair className={cn('size-4', focusOpen && 'text-signal')} />
          </Button>
        </div>
      </div>

      {SPACES_ENABLED ? (
      <Dialog open={newSpaceOpen} onOpenChange={(o) => !o && setNewSpaceOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="size-4 text-signal" /> New Space
            </DialogTitle>
            <DialogDescription>
              Create a collaborative board. Share the link — anyone can join.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label className="os-label">Space name</Label>
            <Input
              autoFocus
              value={newSpaceName}
              onChange={(e) => setNewSpaceName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateSpace()}
              placeholder="e.g. Design Sprint, Family Trip"
            />
          </div>
          <DialogFooter>
            <Button
              size="sm"
              onClick={handleCreateSpace}
              disabled={!newSpaceName.trim() || createSpace.isPending}
            >
              {createSpace.isPending ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      ) : null}

      {selectedSpace ? (
        <SpacesShareDialog
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          spaceName={selectedSpace.name}
          inviteCode={selectedSpace.inviteCode}
        />
      ) : null}
    </>
  )
}
