# Inquiry log

## 2026-08-22 · Dialog deferred-writes review + fix

- **14:xx (approx)** User asked: check the working-tree diff for perf regressions and merge-readiness.
- Reviewed via two adversarial subagents; findings verified against source before fixing.
  - Blocker 1: Done click lost focused subtask renames (activeElement moved at mousedown).
  - Blocker 2: Archive dropped unsaved title/notes edits (regression vs HEAD).
  - Perf: no regressions; uncontrolled inputs are a net win.
- User chose "Fix them now". Fix applied to `src/tracker/board/TaskDetails.tsx`: capture-at-pointerdown (`pendingRef` + `collectPending`), `closeWith(after?)` unified flush, suppress-only `armSuppress` for Delete. Verified by a third subagent: PASS.
- Provider interruptions (503s/timeouts) split the session; an extra brace from a partial edit was caught by `tsc` and fixed.
- Dead end considered: disarming `closingRef` on refocus to close the aborted-press gap — rejected because focus never returns in that scenario, so the fix would not trigger. Left as documented residual edge case (pre-existing).
- Open question for the user: is the portless dev URL change intentional, and should README's `localhost:3000` be updated?
