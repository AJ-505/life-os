# LifeOS

Personal life management for many people. A grid board for projects (Trello-style,
but stackable in 2D and collapsible), a Focus inbox, a native timeline for
deadlines, and a school-document sync script. Each account is a fully private,
reactive board that stays in sync across every device you sign in on.

## Stack

- **TanStack Start** (React, file-based routes)
- **Convex Cloud** — the reactive database + backend functions, wired into
  TanStack Query (`@convex-dev/react-query`)
- **[shoo](https://shoo.dev)** (`@shoojs/react`) — zero-config Google sign-in.
  No Google Console, no client secrets: shoo issues an ES256 JWT and Convex
  trusts it via JWKS (`convex/auth.config.ts`). Each user is the token `subject`.
- **shadcn/ui** + Tailwind v4, dnd-kit for drag & drop
- Fonts self-hosted via Fontsource (no CDN calls)

## Running

```bash
npx convex dev    # first run: log in, provision the dev deployment, codegen.
                  # leave running — it watches convex/ and syncs functions.
pnpm dev          # app on http://localhost:3000 (separate terminal)
pnpm school:sync  # pull all elearning course files into ~/SchoolVault
```

`npx convex dev` writes `CONVEX_DEPLOYMENT` and `VITE_CONVEX_URL` into `.env.local`.
The only auth config is the token audience (shoo scopes tokens to your origin),
already set to the dev origin. For a production deployment, set it to your domain:

```bash
npx convex env set SHOO_AUD origin:https://your-domain
```

`.env.local` also holds the `ELEARNING_USERNAME` / `ELEARNING_PASSWORD` pair for
school-sync (a local filesystem script, unrelated to the app database).

## Architecture: vertical slices

Code is organized by feature, not by technical type
([the vertical codebase](https://tkdodo.eu/blog/the-vertical-codebase)).
Each vertical exposes a public interface through its `index.ts`; don't deep-import
across verticals.

```
convex/            the backend: reactive functions + schema, scoped per user
  schema.ts          projects/tasks tables, userId-scoped (userId = shoo subject)
  tracker.ts         all board CRUD; every function gates on ctx auth + ownership
  backup.ts          per-user export/import (JSON v1, same wire format as before)
  auth.config.ts     trusts shoo as a custom JWT issuer (JWKS, ES256)
src/
  design-system/   shadcn ui kit, theme (light/dark), cn — shared visual language
  auth/            shoo adapter (shoo.ts), login screen, sign-out
  tracker/         the whole projects/tasks/focus domain
    queries.ts       boardQueryOptions + Convex optimistic mutations
    board/           2D grid board, project cards, dnd logic
    focus/           focus panel (clone-by-reference inbox)
    timeline/        deadline buckets across all projects
    library/         shelf / accomplished / archived views
  backup/          export & import your own data as JSON
  shell/           app frame: sidebar, mobile nav
  routes/          thin glue: route files call into verticals
```

## Primitives

- **Project**: `active` (on the board) · `shelved` (out of sight *and* out of
  mind, restorable from Library → Shelf) · `done` (finished; lives in
  Library → Accomplished) · delete is permanent.
- **Task**: open/done, archivable (hidden but kept), optional due date & notes.
- **Focus**: a task toggled into focus *stays in its project* — the focus panel
  is a view of references, ordered independently, with a project color cue.
- **Board grid**: columns × stacked rows; positions are fractional numbers so
  reordering is a single-field patch.
- **Backup**: sidebar → Export downloads a JSON snapshot of *your* data; Import
  replaces *your* data with a snapshot (confirmed, destructive). Other accounts
  are untouched.

## school-sync

`scripts/school-sync.ts` logs into the PAU elearning (Moodle) via the mobile
web-service API — no browser, no captcha — walks every enrolled course, and
downloads each file into `~/SchoolVault/<course>/<section>/<module>/`,
maintaining a `.manifest.json` so re-runs only fetch what changed, plus a
`README.md` index. Point an AI at that folder and ask away.

`pnpm school:sync -- --dry` previews without downloading.
