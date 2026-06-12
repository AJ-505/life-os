import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  CalendarRange,
  LayoutGrid,
  Library as LibraryIcon,
  Menu,
} from 'lucide-react'

import { ModeToggle, cn } from '#/design-system'
import { Button } from '#/design-system/ui/button'
import { Sheet, SheetContent, SheetTrigger } from '#/design-system/ui/sheet'
import { Separator } from '#/design-system/ui/separator'
import { BackupControls } from '#/backup'

const NAV = [
  { to: '/', label: 'Board', icon: LayoutGrid },
  { to: '/timeline', label: 'Timeline', icon: CalendarRange },
  { to: '/library', label: 'Library', icon: LibraryIcon },
] as const

function Wordmark() {
  return (
    <Link to="/" className="flex items-baseline gap-1.5 px-2 no-underline">
      <span className="text-xl font-bold tracking-tight text-foreground">
        Life
      </span>
      <span className="rounded bg-signal px-1.5 py-0.5 font-mono text-xs font-bold text-signal-foreground">
        OS
      </span>
    </Link>
  )
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map(({ to, label, icon: Icon }) => (
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
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
              )}
            >
              <Icon
                className={cn('size-4', isActive && 'text-signal')}
                strokeWidth={isActive ? 2.4 : 2}
              />
              {label}
            </span>
          )}
        </Link>
      ))}
    </nav>
  )
}

function SidebarFooter() {
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

  return (
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden w-52 shrink-0 flex-col justify-between border-r border-sidebar-border bg-sidebar p-3 md:flex">
        <div className="flex flex-col gap-6">
          <div className="pt-2">
            <Wordmark />
            <p className="os-label mt-1 px-2">everything, in one place</p>
          </div>
          <NavLinks />
        </div>
        <SidebarFooter />
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
  )
}
