import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  Check,
  ChevronDown,
  Crosshair,
  Link as LinkIcon,
  Plus,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '#/design-system'
import { Button } from '#/design-system/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/design-system/ui/dropdown-menu'
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

/**
 * The space switcher, and the shared-board actions.
 *
 * A menu of links rather than a select: this is navigation between places, so
 * every entry is a real anchor with working keyboard and middle-click
 * behaviour, and a handful of items cannot produce a scrolling list. Only
 * mounted inside a space, so the personal board has no spaces chrome at all.
 */
function SpaceChrome({ spaceId }: { spaceId: string }) {
  const navigate = useNavigate()
  const { data: spaces } = useQuery({ ...mySpacesQueryOptions, retry: false })
  const [shareOpen, setShareOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const list = spaces ?? []
  const current = list.find((s) => s.id === spaceId) ?? null

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 max-w-[11rem] gap-1.5"
            aria-label="Switch space"
            title="Switch space"
          >
            <span className="truncate">{current?.name ?? 'Shared board'}</span>
            <ChevronDown className="size-3.5 shrink-0 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-72 w-56 overflow-y-auto"
        >
          <DropdownMenuLabel className="font-semibold">
            Your spaces
          </DropdownMenuLabel>
          {list.length === 0 ? (
            <DropdownMenuItem disabled>No spaces yet</DropdownMenuItem>
          ) : (
            list.map((s) => (
              <DropdownMenuItem
                key={s.id}
                asChild
                onSelect={() => setMenuOpen(false)}
              >
                <Link
                  to="/space/$spaceId"
                  params={{ spaceId: s.id }}
                  className="no-underline"
                  // Radix closes on select only when the item handles the click;
                  // a Link prevents default, so the close is explicit here.
                  onClick={() => setMenuOpen(false)}
                >
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  {s.id === spaceId ? <Check className="size-3.5" /> : null}
                </Link>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void navigate({ to: '/spaces' })}>
            All spaces…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
 * The spaces chrome mounts only inside a space, and only when the build flag is
 * on, so the personal board carries none of it and a flag-off build runs no
 * spaces query from here.
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
  const inSpace = SPACES_ENABLED && spaceId !== null

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5 sm:px-4">
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="hidden items-center gap-2.5 sm:flex">
          <h1 className="text-lg font-bold leading-none tracking-tight">
            {inSpace ? <SpaceTitle spaceId={spaceId} /> : 'Board'}
          </h1>
          <span className="hidden text-sm leading-none text-muted-foreground lg:inline">
            {activeCount} projects · {openCount} open tasks
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 sm:gap-2">
        {inSpace ? <SpaceChrome spaceId={spaceId} /> : null}
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
