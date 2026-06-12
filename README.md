# LifeOS

Personal life management, all on-device. A grid board for projects (Trello-style,
but stackable in 2D and collapsible), a Focus inbox, a native timeline for
deadlines, and a school-document sync script — no external services, no cloud DB.

## Stack

- **TanStack Start** (React, file-based routes, server functions)
- **PostgreSQL (local)** + **Drizzle ORM** — connects over the unix socket
- **shadcn/ui** + Tailwind v4, dnd-kit for drag & drop
- Fonts self-hosted via Fontsource (no CDN calls)

## Running

```bash
pnpm dev          # app on http://localhost:3000
pnpm db:push      # sync Drizzle schema to the local `lifeos` database
pnpm db:studio    # browse the DB
pnpm school:sync  # pull all elearning course files into ~/SchoolVault
```

`.env.local` holds `DATABASE_URL` (already pointed at the local socket) and the
`ELEARNING_USERNAME` / `ELEARNING_PASSWORD` pair for school-sync.

## Architecture: vertical slices

Code is organized by feature, not by technical type
([the vertical codebase](https://tkdodo.eu/blog/the-vertical-codebase)).
Each vertical exposes a public interface through its `index.ts`; don't deep-import
across verticals.

```
src/
  design-system/   shadcn ui kit, theme (light/dark), cn — shared visual language
  tracker/         the whole projects/tasks/focus domain
    schema.ts        drizzle tables (drizzle.config globs src/*/schema.ts)
    server.ts        server functions (CRUD)
    queries.ts       query options + optimistic mutations
    board/           2D grid board, project cards, dnd logic
    focus/           focus panel (clone-by-reference inbox)
    timeline/        deadline buckets across all projects
    library/         shelf / accomplished / archived views
  backup/          export & import the entire DB as JSON
  shell/           app frame: sidebar, mobile nav
  routes/          thin glue: route files call into verticals
  db/              drizzle client
```

## Primitives

- **Project**: `active` (on the board) · `shelved` (out of sight *and* out of
  mind, restorable from Library → Shelf) · `done` (finished; lives in
  Library → Accomplished) · delete is permanent.
- **Task**: open/done, archivable (hidden but kept), optional due date & notes.
- **Focus**: a task toggled into focus *stays in its project* — the focus panel
  is a view of references, ordered independently, with a project color cue.
- **Board grid**: columns × stacked rows; positions are fractional doubles so
  reordering is one `UPDATE`.
- **Backup**: sidebar → Export downloads a JSON snapshot; Import replaces the
  database with a snapshot (confirmed, destructive).

## school-sync

`scripts/school-sync.ts` logs into the PAU elearning (Moodle) via the mobile
web-service API — no browser, no captcha — walks every enrolled course, and
downloads each file into `~/SchoolVault/<course>/<section>/<module>/`,
maintaining a `.manifest.json` so re-runs only fetch what changed, plus a
`README.md` index. Point an AI at that folder and ask away.

`pnpm school:sync -- --dry` previews without downloading.
