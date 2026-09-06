import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
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
import { toast } from 'sonner'

import { ComingSoon, ModeToggle, cn, useLocalFlag } from '#/design-system'
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
import { Label } from '#/design-system/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/design-system/ui/select'
import { Separator } from '#/design-system/ui/separator'
import { Sheet, SheetContent, SheetTrigger } from '#/design-system/ui/sheet'
import { Switch } from '#/design-system/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#/design-system/ui/tooltip'
import { BackupControls } from '#/backup'
import { SignOutButton } from '#/auth'
import {
  calendarSettingsQueryOptions,
  useUpdateCalendarSettings,
} from '#/settings/queries'
import { useGoogleCalendar } from '#/settings/googleCalendar'

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
}: {
  onNavigate?: () => void
  collapsed?: boolean
}) {
  const item = (to: string, label: string, Icon: typeof Users) => {
    const link = (
      <Link
        key={to}
        to={to}
        onClick={onNavigate}
        className="no-underline"
        activeOptions={{ exact: to === '/' }}
      >
        {({ isActive }) => (
          <span
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
              collapsed && 'justify-center px-0',
              isActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
            )}
          >
            <Icon
              className={cn('size-4', isActive && 'text-signal')}
              strokeWidth={isActive ? 2.4 : 2}
            />
            {!collapsed ? label : null}
          </span>
        )}
      </Link>
    )
    return collapsed ? (
      <Tooltip key={to}>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    ) : (
      link
    )
  }
  return (
    <>
      <nav className="flex flex-col gap-1 mb-5">
        {NAV.map(({ to, label, icon: Icon }) => item(to, label, Icon))}
      </nav>
      {/* Spaces teaser: its own group below the main nav. It stays
          visible while Spaces is gated and lands on the ComingSoon page. */}
      <nav className="flex flex-col gap-1" aria-label="Spaces">
        {item('/spaces', 'Spaces', Users)}
      </nav>
    </>
  )
}

function SettingsDialog({ collapsed }: { collapsed?: boolean }) {
  const [open, setOpen] = useState(false)
  const { data: settings } = useQuery(calendarSettingsQueryOptions)
  const updateSettings = useUpdateCalendarSettings()

  const { connection, connect } = useGoogleCalendar()
  const enabled = settings?.syncEnabled ?? false
  const googleConnected = connection.status === 'connected'
  const defaultReminder = settings?.defaultReminderMinutes ?? 15

  const handleToggle = (checked: boolean) => {
    updateSettings.mutate({ syncEnabled: checked })
  }

  /**
   * The old version caught an OAuth failure, wrote `googleConnected: true`
   * anyway and toasted "connected (mock)". Every later sync then ran against a
   * permission that was never granted, and failed where nobody was looking.
   */
  const handleConnect = async () => {
    try {
      await connect()
    } catch (e) {
      toast.error('Could not connect Google Calendar', {
        description: e instanceof Error ? e.message : String(e),
      })
    }
  }

  // Turning sync off stops Life OS pushing anything. Unlinking the Google
  // account itself is Clerk's job and lives in the Clerk user profile, so we
  // don't pretend to do it here.
  const handleDisconnect = () => {
    updateSettings.mutate({ syncEnabled: false })
    toast.success('Calendar sync turned off')
  }

  const handleReminderChange = (v: string) => {
    updateSettings.mutate({ defaultReminderMinutes: Number(v) })
  }

  const needsScope = connection.status === 'needs_scope'

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
          <DialogDescription className="sr-only">App settings and integrations</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {CALENDAR_ENABLED ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">Calendar Integration</h3>
            <Separator />

            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <Label className="text-sm font-medium">Enable Google Calendar Sync</Label>
                {!enabled ? (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    Connect your Google Calendar to sync task times
                  </span>
                ) : null}
              </div>
              <Switch checked={enabled} onCheckedChange={handleToggle} />
            </div>

            {enabled && !googleConnected ? (
              <div className="rounded-md border border-dashed p-3">
                <p className="text-xs leading-snug text-muted-foreground">
                  {needsScope
                    ? 'Your Google account is linked but has not granted calendar access yet.'
                    : 'Connect your Google account to push task times to your calendar.'}
                </p>
                <Button size="sm" className="mt-2 w-full" onClick={handleConnect}>
                  {needsScope
                    ? 'Grant calendar access'
                    : 'Connect Google Calendar'}
                </Button>
              </div>
            ) : null}

            {enabled && googleConnected ? (
              <div className="flex items-center justify-between rounded-md border bg-accent/30 px-3 py-2">
                <span className="flex items-center gap-2 text-sm">
                  <span className="size-2 rounded-full bg-emerald-500" />
                  Connected
                </span>
                <Button variant="ghost" size="sm" onClick={handleDisconnect}>
                  Turn off sync
                </Button>
              </div>
            ) : null}

            <div className="flex items-center justify-between">
              <Label className="os-label">Default reminder</Label>
              <Select value={String(defaultReminder)} onValueChange={handleReminderChange}>
                <SelectTrigger size="sm" className="w-[140px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 minutes before</SelectItem>
                  <SelectItem value="15">15 minutes before</SelectItem>
                  <SelectItem value="30">30 minutes before</SelectItem>
                  <SelectItem value="60">60 minutes before</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
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

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [collapsed, setCollapsed] = useLocalFlag('lifeos-sidebar-collapsed', false)

  // `[` toggles the sidebar (mirrors `]` for the focus panel).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.isContentEditable)
      )
        return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '[') {
        e.preventDefault()
        setCollapsed(!collapsed)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [collapsed, setCollapsed])

  return (
    <TooltipProvider delayDuration={300}>
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      {/* Desktop sidebar */}
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
            <p className="-mt-4 px-2 text-sm text-muted-foreground">Everything, in one place.</p>
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
          <NavLinks collapsed={collapsed} />
        </div>
        <SidebarFooter collapsed={collapsed} />
      </aside>

      {/* Mobile top bar */}
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
            <NavLinks onNavigate={() => setMobileNavOpen(false)} />
            <SidebarFooter />
          </SheetContent>
        </Sheet>
        <Wordmark />
        <ModeToggle />
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
    </TooltipProvider>
  )
}
