import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  CalendarRange,
  LayoutGrid,
  Library as LibraryIcon,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'

import { ModeToggle, cn, useLocalFlag } from '#/design-system'
import { Button } from '#/design-system/ui/button'
import { Sheet, SheetContent, SheetTrigger } from '#/design-system/ui/sheet'
import { Separator } from '#/design-system/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#/design-system/ui/tooltip'
import { BackupControls } from '#/backup'

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
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map(({ to, label, icon: Icon }) => {
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
      })}
    </nav>
  )
}

function SidebarFooter({ collapsed }: { collapsed?: boolean }) {
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-3 pb-1">
        <ModeToggle />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <BackupControls />
      <Separator />
      <div className="flex items-center justify-between px-2 pb-1">
        <span className="os-label">local · v1</span>
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
          'hidden shrink-0 flex-col justify-between border-r border-sidebar-border bg-sidebar p-3 transition-[width] duration-200 md:flex',
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
            <p className="os-label -mt-4 px-2">everything, in one place</p>
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
          <SheetContent side="left" className="flex w-64 flex-col justify-between bg-sidebar p-3 pt-12">
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
