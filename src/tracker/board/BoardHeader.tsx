import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Crosshair, Link as LinkIcon, Plus, Users } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '#/design-system'
import { Button } from '#/design-system/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/design-system/ui/select'
import { Switch } from '#/design-system/ui/switch'

import { mySpacesQueryOptions, useSpaceMembers } from '#/spaces/queries'
import {
  SpacesShareDialog,
  memberInitials,
  shortMemberId,
} from '#/spaces/components/SpacesShareDialog'
import { SPACES_ENABLED } from '#/feature-flags'
import { useBoardScope } from '../board-scope'

/** Clerk ids are long; two characters is what fits in a 24px circle. */
function MemberStack({ spaceId }: { spaceId: string }) {
  const members = useSpaceMembers(spaceId)
  const list = members ?? []
  if (list.length === 0) return null
  const shown = list.slice(0, 3)
  return (
    <div className="hidden items-center sm:flex">
      <div className="flex -space-x-1.5">
        {shown.map((m, i) => (
          <span
            key={m.userId}
            style={{ zIndex: 3 - i }}
            title={m.isSelf ? 'You' : shortMemberId(m.userId)}
            className="flex size-6 items-center justify-center rounded-full border-2 border-background bg-signal text-[10px] font-bold text-signal-foreground"
          >
            {memberInitials(m.userId)}
          </span>
        ))}
      </div>
      {list.length > shown.length ? (
        <span className="ml-1.5 text-[11px] text-muted-foreground">
          +{list.length - shown.length}
        </span>
      ) : null}
    </div>
  )
}

/** The space's own name for the title slot. Only mounted when Spaces is on, so
 *  the flag off means no spaces query at all. */
function SpaceTitle({ spaceId }: { spaceId: string }) {
  const { data: spaces } = useQuery({ ...mySpacesQueryOptions, retry: false })
  const name = spaces?.find((s) => s.id === spaceId)?.name
  return <>{name ?? 'Shared board'}</>
}

/** The board switcher, and the shared-board actions. Personal is a peer of
 *  every space rather than a hidden default. */
function SpaceChrome({ spaceId }: { spaceId: string | null }) {
  const navigate = useNavigate()
  const { data: spaces } = useQuery({ ...mySpacesQueryOptions, retry: false })
  const [shareOpen, setShareOpen] = useState(false)
  const list = spaces ?? []
  const current =
    spaceId === null ? null : (list.find((s) => s.id === spaceId) ?? null)

  return (
    <>
      <Select
        value={spaceId ?? 'personal'}
        onValueChange={(next) => {
          if (next === 'personal') void navigate({ to: '/' })
          else
            void navigate({
              to: '/space/$spaceId',
              params: { spaceId: next },
            })
        }}
      >
        <SelectTrigger size="sm" className="h-8 w-[9.5rem] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="personal">Personal</SelectItem>
          {list.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Link
        to="/spaces"
        className="no-underline"
        title="Manage spaces"
        aria-label="Manage spaces"
      >
        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">
          Spaces
        </Button>
      </Link>

      {current ? (
        <>
          <MemberStack spaceId={current.id} />
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            onClick={async () => {
              const link = `${window.location.origin}/join/${current.inviteCode}`
              await navigator.clipboard.writeText(link)
              toast.success('Link copied')
            }}
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
          <SpacesShareDialog
            open={shareOpen}
            onClose={() => setShareOpen(false)}
            spaceId={current.id}
            spaceName={current.name}
            inviteCode={current.inviteCode}
          />
        </>
      ) : null}
    </>
  )
}

/**
 * Board header. The active board is read from the route (see `useBoardScope`),
 * never from localStorage: a space that only exists in this browser would be a
 * space with no server behind it.
 *
 * The spaces chrome is a child that only mounts when the build flag is on, so a
 * gated build runs no spaces query at all.
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
  const spaceId = useBoardScope()

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5 sm:px-4">
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="hidden items-center gap-2.5 sm:flex">
          <h1 className="text-lg font-bold leading-none tracking-tight">
            {spaceId === null || !SPACES_ENABLED ? (
              'Board'
            ) : (
              <SpaceTitle spaceId={spaceId} />
            )}
          </h1>
          <span className="hidden text-sm leading-none text-muted-foreground lg:inline">
            {activeCount} projects · {openCount} open tasks
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 sm:gap-2">
        {SPACES_ENABLED ? <SpaceChrome spaceId={spaceId} /> : null}
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
        {/* Focus is personal only, and the rail is hidden on a shared board. */}
        {spaceId === null ? (
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
        ) : null}
      </div>
    </div>
  )
}
