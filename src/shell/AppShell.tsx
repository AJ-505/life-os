import { useEffect, useRef, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { useUser } from '@clerk/tanstack-react-start'
import { useConvexMutation } from '@convex-dev/react-query'
import {
  CalendarRange,
  LayoutGrid,
  Library as LibraryIcon,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Users,
} from 'lucide-react'

import {
  ComingSoon,
  ModeToggle,
  cn,
  flagCodec,
  storedValue,
  useKeyShortcuts,
  useStored,
} from '#/design-system'
import { CALENDAR_ENABLED } from '#/feature-flags'
import { Button } from '#/design-system/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/design-system/ui/dialog'
import { Separator } from '#/design-system/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '#/design-system/ui/sheet'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#/design-system/ui/tooltip'
import { BackupControls } from '#/backup'
import { SignOutButton } from '#/auth'
import {
  useEnsureTimezone,
  useRestoreCalendarAccess,
} from '#/settings/googleCalendar'
import { CalendarSettings } from '#/settings/CalendarSettings'
import { useSpacesNavTarget } from '#/spaces/last-space'
import type { SpacesNavTarget } from '#/spaces/last-space'
import { usePrefetchRoutes } from '#/prefetch/prefetch-routes'
import { api } from '../../convex/_generated/api'

const NAV = [
  { to: '/', label: 'Board', icon: LayoutGrid },
  { to: '/timeline', label: 'Timeline', icon: CalendarRange },
  { to: '/library', label: 'Library', icon: LibraryIcon },
] as const

function Wordmark({ collapsed }: { collapsed?: boolean }) {
  return (
    <Link to="/" className="flex items-baseline gap-1.5 px-2 no-underline">
      {!collapsed ? (
        <span className="text-xl font-bold tracking-tight text-foreground">
          Life
        </span>
      ) : null}
      <span className="rounded bg-signal px-1.5 py-0.5 font-mono text-xs font-bold text-signal-foreground">
        OS
      </span>
    </Link>
  )
}

function NavLinks({
  onNavigate,
  collapsed,
  spacesTarget,
}: {
  onNavigate?: () => void
  collapsed?: boolean
  spacesTarget: SpacesNavTarget
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const segment = pathname.split('/')[1] ?? ''
  const inSpacesArea = segment === 'spaces' || segment === 'space'

  const item = (
    target: SpacesNavTarget | { to: (typeof NAV)[number]['to'] },
    label: string,
    Icon: typeof Users,
    alsoActive = false,
  ) => {
    const link = (
      <Link
        key={label}
        {...target}
        onClick={onNavigate}
        aria-current={alsoActive ? 'page' : undefined}
        aria-label={collapsed ? label : undefined}
        className="no-underline"
        activeOptions={{ exact: target.to === '/', includeSearch: false }}
      >
        {({ isActive }) => {
          const active = isActive || alsoActive
          return (
            <span
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                collapsed && 'justify-center px-0',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
              )}
            >
              <Icon
                className={cn('size-4', active && 'text-signal')}
                strokeWidth={active ? 2.4 : 2}
              />
              {!collapsed ? label : null}
            </span>
          )
        }}
      </Link>
    )
    return collapsed ? (
      <Tooltip key={label}>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    ) : (
      link
    )
  }
  return (
    <nav className="flex flex-col gap-1" aria-label="Main navigation">
      {NAV.map(({ to, label, icon: Icon }) => item({ to }, label, Icon))}
      {item(
        inSpacesArea ? { to: '/spaces' } : spacesTarget,
        'Spaces',
        Users,
        inSpacesArea,
      )}
    </nav>
  )
}

function ProfileSync() {
  const { user } = useUser()
  const syncProfile = useConvexMutation(api.spaces.syncUserProfile)
  const displayName =
    user?.fullName ?? user?.username ?? user?.primaryEmailAddress?.emailAddress
  const email = user?.primaryEmailAddress?.emailAddress
  const syncedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!user || !displayName) return
    const signature = `${user.id}|${displayName}|${email ?? ''}`
    if (syncedRef.current === signature) return
    syncedRef.current = signature
    void syncProfile({ displayName, ...(email ? { email } : {}) })
  }, [user, displayName, email, syncProfile])

  return null
}

function EnsureTimezone() {
  useEnsureTimezone()
  return null
}

function RestoreCalendarAccess() {
  useRestoreCalendarAccess()
  return null
}

function PrefetchRoutes() {
  usePrefetchRoutes()
  return null
}

function SettingsDialog({ collapsed }: { collapsed?: boolean }) {
  const [open, setOpen] = useState(false)

  const trigger = collapsed ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            aria-label="Settings"
          >
            <Settings className="size-4" />
          </Button>
        </DialogTrigger>
      </TooltipTrigger>
      <TooltipContent side="right">Settings</TooltipContent>
    </Tooltip>
  ) : (
    <DialogTrigger asChild>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground"
        aria-label="Settings"
      >
        <Settings className="size-4" />
      </Button>
    </DialogTrigger>
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger}
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">
            App settings and integrations
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {CALENDAR_ENABLED ? (
            <CalendarSettings />
          ) : (
            <ComingSoon
              title="Calendar sync"
              description="Google Calendar integration is on its way. Tasks, due dates, and reminders keep working."
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SidebarFooter({ collapsed }: { collapsed?: boolean }) {
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-3 pb-1">
        <SettingsDialog collapsed />
        <ModeToggle />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <BackupControls />
      <Separator />
      <SignOutButton />
      <Separator />
      <div className="flex items-center justify-between px-2 pb-1">
        <span className="flex items-center gap-2">
          <SettingsDialog />
          <span className="os-label">cloud · v1</span>
        </span>
        <ModeToggle />
      </div>
    </div>
  )
}

const sidebarCollapsed = storedValue(
  'lifeos-sidebar-collapsed',
  flagCodec,
  false,
)

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [collapsed, setCollapsed] = useStored(sidebarCollapsed)
  const spacesTarget = useSpacesNavTarget()

  useKeyShortcuts((event) => {
    if (event.key !== '[') return
    event.preventDefault()
    setCollapsed(!collapsed)
  })

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
        <aside
          className={cn(
            'hidden shrink-0 flex-col justify-between border-r border-sidebar-border bg-sidebar p-3 md:flex',
            collapsed ? 'w-16 items-center' : 'w-52',
          )}
        >
          <div className="flex w-full flex-col gap-6">
            <div className="flex items-center justify-between pt-2">
              <Wordmark collapsed={collapsed} />
              {!collapsed ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground"
                  aria-label="Collapse sidebar ([)"
                  title="Collapse sidebar  ["
                  onClick={() => setCollapsed(true)}
                >
                  <PanelLeftClose className="size-4" />
                </Button>
              ) : null}
            </div>
            {!collapsed ? (
              <p className="-mt-4 px-2 text-sm text-muted-foreground">
                Everything, in one place.
              </p>
            ) : null}
            {collapsed ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-9 text-muted-foreground"
                aria-label="Expand sidebar ([)"
                title="Expand sidebar  ["
                onClick={() => setCollapsed(false)}
              >
                <PanelLeftOpen className="size-4" />
              </Button>
            ) : null}
            <NavLinks collapsed={collapsed} spacesTarget={spacesTarget} />
          </div>
          <SidebarFooter collapsed={collapsed} />
        </aside>

        <header className="flex h-14 shrink-0 items-center justify-between border-b border-sidebar-border bg-sidebar px-2 md:hidden">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Menu">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              noAnimation
              className="flex w-64 flex-col justify-between bg-sidebar p-3 pt-12"
            >
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SheetDescription className="sr-only">
                Move between sections of Life OS
              </SheetDescription>
              <NavLinks
                onNavigate={() => setMobileNavOpen(false)}
                spacesTarget={spacesTarget}
              />
              <SidebarFooter />
            </SheetContent>
          </Sheet>
          <Wordmark />
          <ModeToggle />
        </header>

        {CALENDAR_ENABLED ? <EnsureTimezone /> : null}
        {CALENDAR_ENABLED ? <RestoreCalendarAccess /> : null}
        <ProfileSync />
        <PrefetchRoutes />
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
      </div>
    </TooltipProvider>
  )
}
