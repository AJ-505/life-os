# Statecharts

Each folder is one state machine that the app already had, written down as a
TLA+ model and checked with TLC. The model is the source of truth. `chart.mmd`
and `chart.svg` are what TLC found, and `report.md` says which rules broke and
the shortest path to each break.

The models describe the code in `convex/` and `src/`. When the code changes,
run them again: a model that no longer matches is worse than no model.

## Run them

The runner is the `statechart` skill. It needs Node and Java, and the first run
installs TLC. Heavy work belongs on CI, so the models run there.

```sh
# 1. copy the models into the skill's scratch folder
mkdir -p ~/code/aisandbox/.scratch/life-os
cp -r docs/statecharts/* ~/code/aisandbox/.scratch/life-os/

# 2. run them from the aisandbox checkout, which holds the skill
cd ~/code/aisandbox
~/.local/bin/ci run --timeout 25 --artifact /tmp/statecharts.tgz --out /tmp/sc -- \
  "bash .scratch/run-all.sh"
```

`report.md` and `chart.mmd` land in `/tmp/sc/out/<machine>/`. Copy them back
into the folder they came from.

## What is modelled

| Folder             | Machine                                                             | Code                                                            |
| ------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| `ProjectLifecycle` | A project on the board, in the Library, done, deleted               | `convex/tracker.ts` `setProjectStatus`, `deleteProject`         |
| `TaskLifecycle`    | A task on the board, in the Library, ticked off, deleted            | `convex/tracker.ts` `updateTask`, `deleteTask`                  |
| `CalendarSync`     | One task's Google event, the two settings, the push and the cleanup | `convex/calendar.ts`, `convex/settings.ts`, `convex/tracker.ts` |
| `CalendarPull`     | The gate that decides when the Calendar view reads Google           | `src/tracker/calendar/pull.ts`, `convex/calendarPull.ts`        |
| `SpaceMembership`  | One person in a shared space: membership, throttle, assigned work   | `convex/spaces.ts`                                              |

## What these rules are

- `ProjectLifecycle`: a live project is on one screen only, a finished or
  shelved project remembers when, and leaving the board never deletes the work.
- `TaskLifecycle`: a live task is on one screen only, the Library is exactly the
  archive, and ticking a task off never moves it.
- `CalendarSync`: a settled task that wants an event has one or says why, a
  settled task that does not want one has no event left in Google, and a rate
  limit always has a retry waiting.
- `CalendarPull`: a window the cache calls covered is a window whose pull
  reached Google and came back.
- `SpaceMembership`: while a space exists it has exactly one owner, that owner
  is inside, and work never keeps naming someone who fell out.

## Not modelled

These are the other state machines in the app, and why they are not here yet.

| Machine                                                                                     | Why not                                                                                                                                                     |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Batch jobs that reschedule (space delete, sync-off cleanup, auto-add backfill, cache purge) | The rule is "the cascade finishes or can be resumed", which needs a liveness property rather than a reachable-state check.                                  |
| Sign-in                                                                                     | The states live in Clerk, not in this repo.                                                                                                                 |
| Join a space page                                                                           | `idle`, `loading`, `success`, `error` over one request. A chart of four states adds nothing the union does not.                                             |
| Task details dialog                                                                         | The capture-now/write-later path (deferred writes, the closing guard) is worth a model; it is the next one to write.                                        |
| Board drag and drop                                                                         | The active drag and its kind are two variables for one fact, and the drop routing is a table. A model would check the table, not a state machine.           |
| Calendar create and resize                                                                  | Pure pointer arithmetic, no lasting state.                                                                                                                  |
| Backup import                                                                               | `idle`, `file chosen`, `busy`, `error`. The interesting part is the file format, which is tested in code.                                                   |
| New version prompt                                                                          | `idle`, `available`, `downloading`. It is a liveness question, not a safety one.                                                                            |
| Task focus                                                                                  | Two states per task (`inFocus`), orthogonal to the task lifecycle. It belongs in `TaskLifecycle` as a second region when the calendar coupling is modelled. |
| Recurring tasks                                                                             | Completing one rolls the date instead of closing the task. A model needs the clock, so it belongs with the recurrence tests in `convex/recurrence.test.ts`. |
