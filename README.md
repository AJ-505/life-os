# Life OS

Everything, in one place.

Life OS is a place to run your life. Projects, tasks, deadlines, and focus — without juggling five different apps.

Live at **https://lifeos-track.vercel.app**

---

## What it is

Most people split their life across a task app, a calendar, a notes app, and whatever their team uses for collaboration. Life OS keeps it in one board. Private by default, collaborative when you want it to be.

## Board

The board is a grid of projects. Each project has its own colour, its own tasks, and lives in a column you can rearrange by dragging. Tasks drag between projects and reorder inside them.

Inside a task you get notes, subtasks, a due date with a 24-hour time, and the option to move it to another project. Subtasks are simple checkable items. Everything saves as you go.

Keyboard: hover any task and hit `f` to focus it, `e` to open it. `]` toggles the Focus panel, `[` toggles the sidebar.

## Focus

Focus is a second view of your tasks that doesn't move them out of their projects. Hit the crosshair on any task or drag it to the panel on the right. It stays where it was — Focus just holds a reference. Reorder, check off, or clear done items when you're finished. On mobile it slides in as a sheet.

## Timeline

Every dated task shows up in Timeline, grouped so you can scan what's actually urgent:

**Overdue · This hour · Today · Tomorrow · This week · Later**

Project target dates appear there too. You can check tasks off or add them to Focus without leaving the view.

## Library

Where finished things live:

- **Shelf** — projects you've shelved to get them off the board. Restore or finish them later.
- **Accomplished** — finished projects and completed tasks grouped by month.
- **Archived** — tasks you've hidden from a project without deleting them.

No separate archive app. It's all in the sidebar.

## Spaces

Your board is private. When you need to work with others, create a Space: a shared board at `/space/<id>` with an invite link at `/join/<code>`. Anyone with the link can join. Live sync keeps everyone on the same page, and members can create, edit and finish work on the same projects.

Two things stay personal, and the app enforces it rather than hiding it:

- **Focus.** Focus is one flag on a task row, so a shared board has no Focus rail.
- **Calendar.** A task's Google event belongs to whoever pushed it, so only personal tasks sync.

Leaving a space is a real action. A member leaves and loses access; an owner hands ownership to the longest-standing member and the invite code rotates. The last member of a space is asked to delete it instead of leaving it ownerless.

> **Not released.** Spaces is behind `VITE_ENABLE_SPACES=1`. Without it the routes render a placeholder and no space query runs.

## Google Calendar

Connect Google Calendar in Settings, then a dated personal task can push to your calendar. Set a date and time, pick a reminder (5, 15, 30, or 60 minutes), enable "Add to calendar."

The event follows the task for its whole life: it is created once, renamed and re-timed in place, and removed when the due date is cleared, the task is completed or archived, the task or its project is deleted, or you turn sync off. Events you delete in Google Calendar are respected rather than recreated; **Resync calendar** in Settings is the explicit way to put them back.

Two details worth knowing:

- The event carries your timezone explicitly, so a 09:00 task stays at 09:00 in your calendar.
- Turning sync off deletes the events Life OS created, and the confirmation says so first.

> **Not released.** Calendar sync is behind `VITE_ENABLE_CALENDAR=1`. Without it the task and settings surfaces render a placeholder and no calendar query runs.

## Backup

Export your data as JSON from the sidebar and import it back anytime. A backup covers your **personal** board only: a space's projects belong to everyone in it, so they are not captured and a restore never touches them. Tasks keep their calendar association across a round trip, and an event whose task the snapshot drops is removed rather than orphaned.

---

## Running locally

```bash
pnpm dev    # runs Vite + Convex together (via portless)
```

`pnpm dev` starts both the app and `convex dev` in one command. It writes `VITE_CONVEX_URL` to `.env.local` on first run.

### The two secrets, and where each one lives

Auth and the calendar push need two values on the **Convex deployment**, not in the front-end env:

```bash
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your>.clerk.accounts.dev
npx convex env set CLERK_SECRET_KEY sk_...
```

- `CLERK_JWT_ISSUER_DOMAIN` is how Convex verifies the session JWT.
- `CLERK_SECRET_KEY` is how the calendar action asks Clerk for a Google access token. Without it, sync reports "not configured on the server" and nothing is lost: the task keeps its intent and its event id stays empty.

`.env.example` carries the same list with the reasoning. A front-end build only needs `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_CONVEX_URL`, and whichever feature flags you are shipping.

## Tests

```bash
pnpm test        # vitest, both projects
pnpm typecheck   # tsc over the app and over convex
pnpm lint        # oxlint
```

`pnpm test` runs two vitest projects. App tests use `node`; the Convex tests use the `edge-runtime` and load the real function modules through `convex-test`, with `convex/test.setup.ts` supplying the deployment env and the Google calls stubbed at `fetch`.

## Deploying

Vercel builds the front end; Convex deploys its own functions.

> **One deployment is serving production right now.** Vercel points at the
> _development_ deployment `elated-egret-903`, so `pnpm dev` and `convex dev`
> push straight to the app your users are on. While that is true, the public
> function contract is append-only: never make an argument required, never
> remove one, and never delete a public function, because a browser out there is
> still running the previous bundle and it will fail on the server. Check before
> every push:
>
> ```bash
> node scripts/check-convex-contract.mjs
> ```
>
> It fetches the live chunks, replays every argument object the deployed client
> sends, and fails on a newly required field or a field that no longer exists.
> Run it by hand before a push (`pnpm check:contract`). It is not wired into
> CI, because it reads the deployment URL from `.env.local` and probes the live
> front end, neither of which CI has. The fix for the coupling is to give Vercel
> its own deployment (see the runbook in the report); until then this check is
> what keeps the contract honest.

1. **Convex.** `npx convex deploy` from the repo root. The two secrets above must already be set on the production deployment.
2. **Vercel.** Build env: `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_CONVEX_URL`, `VITE_ENABLE_SPACES`, `VITE_ENABLE_CALENDAR`. Vite inlines all four at build time, so changing a flag needs a rebuild, not just a redeploy.
3. **Clerk.** A **production** instance, with Google enabled as a social connection and `https://www.googleapis.com/auth/calendar.events` declared as a sensitive scope on the consent screen. A development instance works locally; it cannot be verified for a sensitive scope, which is a Google review with lead time rather than a code change.
4. **CI.** `.github/workflows/ci.yml` runs lint, the test suite and a typecheck on every push.

Order matters: deploy Convex and set its secrets before the front end that points at it, and flip a feature flag only after the surface it unlocks has been deployed.

## Known limits

- The board query reads a user's whole board and a space's whole board in one call. That is deliberate: a bounded read would silently truncate a board. At a few thousand tasks per board it is well inside Convex's per-function read budget.
- `pnpm check` (Prettier) reports pre-existing offenders in files this project has not touched since. Run `pnpm format` if you want the whole tree normalized.
