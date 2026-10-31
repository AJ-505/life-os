# Spaces & Google Calendar audit — 2026-10-03

Deep read of the spaces backend and UI and the Google Calendar push pipeline,
plus a Convex test suite that runs the real functions. Commit `7664ea8`.
Both features ship behind `VITE_ENABLE_SPACES` / `VITE_ENABLE_CALENDAR`
(default off), so none of this is reachable in a default build yet.

The interactive write-up with the raw evidence is
[`2026-10-03-spaces-calendar.html`](./2026-10-03-spaces-calendar.html).

## How to run the regressions

```bash
pnpm test
```

Every finding below is pinned by a test. The open bugs live in a `known bugs`
block and use `it.fails`: the case states the behaviour we want, is red on
purpose, and keeps the suite green. When a fix lands the case starts passing,
`it.fails` turns that into a failure, and the `.fails` comes off.

## Findings

| #   | Finding                                                                | Area        | Severity | Test                                                                                     |
| --- | ---------------------------------------------------------------------- | ----------- | -------- | ---------------------------------------------------------------------------------------- |
| S-1 | `deleteSpace` orphans every task's activity rows                       | spaces      | high     | `convex/spaces.test.ts` · deleteSpace removes the tasks' activity rows                   |
| C-1 | "Resync" cannot restore an event deleted in Google — it needs two runs | calendar    | high     | `convex/calendar.test.ts` · a single Resync recreates an event deleted in Google         |
| S-2 | Un-migrated rows vanish from personal boards until the backfill runs   | spaces      | high     | `convex/migrations.test.ts`                                                              |
| C-2 | Turning sync off deletes the event but keeps `calendarEventId`         | calendar    | medium   | `convex/calendar.test.ts` · turning sync off clears calendarEventId                      |
| S-3 | Removing a member leaves their tasks assigned to them                  | spaces      | medium   | `convex/spaces.test.ts` · removing a member unassigns their tasks                        |
| C-3 | An invalid Clerk secret is reported as "no Google account connected"   | calendar    | medium   | `convex/calendar.test.ts` · reports an invalid Clerk secret as a server misconfiguration |
| S-4 | `deleteSpace` reads the whole space in one transaction                 | spaces      | medium   | `convex/spaces.test.ts` · deleteSpace does not read the whole space in one transaction   |
| U-1 | Client subtree walk loops forever on a parent cycle                    | client      | medium   | `src/tracker/board/board-logic.test.ts` · terminates on a parent cycle                   |
| U-2 | A space task's dialog shows "Calendar sync is on its way"              | calendar UI | low      | code read (`TaskDetails.tsx`)                                                            |
| U-3 | Enter double-submits the create dialogs                                | spaces UI   | low      | code read (`spaces.tsx`, `BoardView.tsx`)                                                |

### S-1 · `deleteSpace` orphans activity history

The cascade passes each task's internal Convex `_id` to the activity lookup,
but `taskActivity` rows are keyed by the app-facing task id, so the lookup
matches nothing and no activity row is deleted. The space, projects, tasks and
members go; the history stays forever. `tracker.ts` already does this correctly
with `task.id`.

- Where: `convex/spaces.ts` (`deleteSpace` collects `_id`s; `deleteSpaceSide`
  queries `taskActivity` with them).
- Fix: carry the app id (or the task rows) through the cascade and look activity
  up by it, as `tracker.ts` does.

### C-1 · Resync cannot put back a deleted event in one run

The Resync control says it re-pushes "including any event deleted in Google".
When Google answers a patch with 404/410, the sync clears the local event id and
returns `event_removed`, whose own message says "Use Resync calendar to put it
back". So the first click clears and fails; only the next click creates. Every
task whose event was deleted — including all of them after toggling sync off and
on — costs two resyncs.

- Where: `convex/calendar.ts` (`dropRemovedEvent`), `src/shell/AppShell.tsx`
  (the control's copy).
- Fix: give the explicit `syncTask` path a "recreate on missing" mode, or clear
  stale ids before a resync. Keep the background scheduler's current behaviour,
  which deliberately does not resurrect events the user deleted.

### S-2 · Un-migrated rows disappear from personal boards

Personal reads filter on `spaceId = null` through `by_user_space`. A row written
before the field existed has no `spaceId` key, and Convex omits it from that
index, so it is invisible until `backfillSpaceId` runs. The schema comment
acknowledges the field is optional until the backfill, but nothing enforces the
order: the migration is a manual `convex run`, there is no deploy hook, and the
read does not treat a missing field as personal the way `backup.ts` does.

- Where: `convex/lib.ts` (`scopeTasks` / `scopeProjects`),
  `convex/migrations.ts`.
- Fix: run the backfill as part of the deploy, or make the personal read
  tolerant of an absent `spaceId` until `migrations.verifySpaceId` is green.

### C-2 · Sync-off keeps the event id

Turning sync off deletes the Google events but leaves `calendarEventId` on the
tasks. The UI still counts them as synced, and the next resync patches an event
that no longer exists — which is C-1. Clear the id when the event is deleted;
keep `addToCalendar`, the user's intent.

- Where: `convex/settings.ts` (`continueSyncOffCleanup`),
  `convex/calendar.ts` (`deleteEventsForUser`).

### S-3 · Removed members stay assigned

`removeMember` drops the membership and rotates the code, but tasks assigned to
that person still point at their id. The assignee dropdown only lists current
members, so those tasks render with no valid selection. Unassign (or reassign to
the owner) in the same transaction.

- Where: `convex/spaces.ts` (`removeMember`).

### C-3 · Bad Clerk secret misdiagnosed

The token fetch tries two Clerk provider slugs and treats any non-OK response as
"try the next one". A wrong or expired `CLERK_SECRET_KEY` returns 401 for both,
and the user is told "No Google account is connected to this Clerk user" — a
user-action message for an operator problem. 403s and 5xxs are swallowed the
same way. Distinguish 401/403 (server credential → `not_configured`) from 404
(provider not linked → try the next slug / `not_connected`).

- Where: `convex/calendar.ts` (`googleAccessToken`).

### S-4 · `deleteSpace` reads the whole space at once

The cascade batches writes, but the first thing it does is `.collect()` every
member, project and task. That read scales with the space, so a space above
Convex's default read cap (~32k docs / 16 MB) cannot be deleted at all: the
first transaction dies before any continuation is scheduled. The continuation
also passes whole id arrays through the scheduler, which cap at 8,192 values.

- Where: `convex/spaces.ts` (`deleteSpace`).
- Fix: page the initial read the way `importBackup` and the sync-off cleanup
  already do.

### U-1 · Client subtree walk loops on a cycle

The server's walks carry a `visited` set because a restored backup can carry a
parent cycle. `descendantIds` does not, so a cycle recurses until the stack
blows. Cycle nodes are hidden from project cards but can appear in the flat
Timeline, where opening one and deleting runs the optimistic `descendantIds`.
Backup import does not validate `parentId`, which is the realistic route in.

- Where: `src/tracker/board/board-logic.ts` (`descendantIds`).
- Fix: add the same visited set `withDescendants` uses.

### U-2 · Space task shows "Calendar sync is on its way"

Calendar sync is personal-only by design, but the task dialog renders the
`ComingSoon` placeholder for shared-space tasks even when the calendar flag is
on. A collaborator is told the feature is coming when it exists and is simply
not available to them.

- Where: `src/tracker/board/TaskDetails.tsx`.

### U-3 · Enter double-submits create dialogs

The New Space and New Project dialogs submit on Enter without checking whether a
request is in flight. The buttons disable while pending, but Enter bypasses
them, so two quick presses create two rows.

- Where: `src/routes/spaces.tsx`, `src/tracker/board/BoardView.tsx`.

## Checked and holding

- Join throttle counts only codes that fail to resolve and blocks the 11th
  attempt.
- Owner succession hands the space to the longest-standing member and rotates
  the invite code; the old link stops working.
- Non-owners cannot delete, reset or remove; non-members cannot read the board
  or the member list.
- `deleteSpace` removes projects, tasks, members and the space document
  (activity rows aside — S-1).
- The Google access token is fetched with the deployment secret and used only
  inside the Convex action; the browser never receives it.

## Caveats

- Google and Clerk are stubbed at `fetch`, so the calendar tests prove the
  code's decision logic, not live Google behaviour.
- S-4 is demonstrated with a lowered `documentsRead` limit so the unbounded read
  is visible at test scale; at Convex defaults the same failure needs ~32,000
  tasks or ~16 MB of task documents.
- U-1 needs a cyclic `parentId` in the database; the mutations reject it, backup
  import does not.
- The two UI findings are code reads, not runtime-proven.
