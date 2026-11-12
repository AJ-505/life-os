---- MODULE ProjectLifecycle ----
\* One project, as convex/tracker.ts keeps it and as the board, the Library
\* and the project card's menu move it. `status` is the whole machine: only
\* an active project is on the board, and everything else waits in the
\* Library until you bring it back or delete it.

VARIABLES status, finishedAt, shelvedAt, tasksExist, alive, onBoard, inLibrary
vars == <<status, finishedAt, shelvedAt, tasksExist, alive, onBoard, inLibrary>>

TypeOK ==
    /\ status \in {"active", "shelved", "done"}
    /\ finishedAt \in BOOLEAN
    /\ shelvedAt \in BOOLEAN
    /\ tasksExist \in BOOLEAN
    /\ alive \in BOOLEAN
    /\ onBoard \in BOOLEAN
    /\ inLibrary \in BOOLEAN

Refresh ==
    /\ onBoard' = (alive' /\ status' = "active")
    /\ inLibrary' = (alive' /\ status' # "active")

Init ==
    /\ status = "active"
    /\ finishedAt = FALSE
    /\ shelvedAt = FALSE
    /\ tasksExist = TRUE
    /\ alive = TRUE
    /\ onBoard = TRUE
    /\ inLibrary = FALSE

\* The card menu's "Shelve".
YouShelveIt ==
    /\ alive /\ status = "active"
    /\ status' = "shelved"
    /\ shelvedAt' = TRUE
    /\ finishedAt' = FALSE
    /\ UNCHANGED <<tasksExist, alive>>
    /\ Refresh

\* The Library's "Restore".
YouPutItBackOnTheBoard ==
    /\ alive /\ status # "active"
    /\ status' = "active"
    /\ shelvedAt' = FALSE
    /\ finishedAt' = FALSE
    /\ UNCHANGED <<tasksExist, alive>>
    /\ Refresh

\* The card menu's "Mark done", or the Library's own button on a shelved one.
YouMarkItDone ==
    /\ alive /\ status # "done"
    /\ status' = "done"
    /\ finishedAt' = TRUE
    /\ shelvedAt' = FALSE
    /\ UNCHANGED <<tasksExist, alive>>
    /\ Refresh

\* Hard delete. The cascade takes the project's tasks and their events.
YouDeleteIt ==
    /\ alive
    /\ alive' = FALSE
    /\ tasksExist' = FALSE
    /\ UNCHANGED <<status, finishedAt, shelvedAt>>
    /\ Refresh

TheProjectIsGone ==
    /\ ~alive
    /\ UNCHANGED vars

Next ==
    \/ YouShelveIt \/ YouPutItBackOnTheBoard \/ YouMarkItDone
    \/ YouDeleteIt \/ TheProjectIsGone

Spec == Init /\ [][Next]_vars

\* A live project is on exactly one of the two screens.
OnOneScreenOnly == alive => (onBoard # inLibrary)

\* A finished project remembers when it finished, and a shelved one when it
\* was shelved. Reopening clears both.
AFinishedProjectRemembersWhen == (status = "done") <=> finishedAt
AShelvedProjectRemembersWhen == (status = "shelved") <=> shelvedAt

\* Leaving the board never deletes the work. Only Delete does.
LeavingTheBoardKeepsTheWork == (alive /\ status # "active") => tasksExist

====
