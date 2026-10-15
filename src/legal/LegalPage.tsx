import { Link } from '@tanstack/react-router'

import type { ReactNode } from 'react'

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string
  updated: string
  children: ReactNode
}) {
  return (
    <div className="min-h-svh overflow-y-auto">
      <main className="mx-auto w-full max-w-2xl px-5 py-12">
        <Link
          to="/"
          className="mb-10 inline-flex items-baseline gap-1.5 no-underline"
        >
          <span className="text-xl font-bold tracking-tight text-foreground">
            Life
          </span>
          <span className="rounded bg-signal px-1.5 py-0.5 font-mono text-xs font-bold text-signal-foreground">
            OS
          </span>
        </Link>
        <h1 className="mb-2 text-3xl font-bold tracking-tight">{title}</h1>
        <p className="os-label mb-8">Last updated {updated}</p>
        <div className="flex flex-col gap-6 text-sm leading-relaxed text-muted-foreground [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:mb-1 [&_ul]:list-disc [&_ul]:pl-5 [&_a]:text-signal [&_a]:underline [&_p:not(:last-child)]:mb-3">
          {children}
        </div>
        <nav className="mt-12 flex gap-4 border-t pt-6 text-sm">
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/">Open Life OS</Link>
        </nav>
      </main>
    </div>
  )
}
