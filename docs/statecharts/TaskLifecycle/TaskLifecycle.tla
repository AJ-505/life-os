---- MODULE TaskLifecycle ----
\* One task row, as convex/tracker.ts keeps it and as the board and the
\* Library show it. `archived` is the only field that moves a task between
\* the two screens; `done` is a separate mark that both screens can show.

VARIABLES done, archived, alive, board, library
vars == <<done, archived, alive, board, library>>

TypeOK ==
    /\ done \in BOOLEAN
    /\ archived \in BOOLEAN
    /\ alive \in BOOLEAN
    /\ board \in BOOLEAN
    /\ library \in BOOLEAN

\* The two screens are reads of the one row: the board lists every live task
\* that is not archived, the Library lists every live task that is. An
\* optimistic patch writes the row and both reads in one go, so no reader
\* ever sees them disagree.
Refresh ==
    /\ board' = (alive' /\ ~archived')
    /\ library' = (alive' /\ archived')

Init ==
    /\ done = FALSE
    /\ archived = FALSE
    /\ alive = TRUE
    /\ board = TRUE
    /\ library = FALSE

YouTickItOff ==
    /\ alive /\ ~done
    /\ done' = TRUE
    /\ UNCHANGED <<archived, alive>>
    /\ Refresh

YouReopenIt ==
    /\ alive /\ done
    /\ done' = FALSE
    /\ UNCHANGED <<archived, alive>>
    /\ Refresh

YouArchiveIt ==
    /\ alive /\ ~archived
    /\ archived' = TRUE
    /\ UNCHANGED <<done, alive>>
    /\ Refresh

YouRestoreIt ==
    /\ alive /\ archived
    /\ archived' = FALSE
    /\ UNCHANGED <<done, alive>>
    /\ Refresh

YouDeleteIt ==
    /\ alive
    /\ alive' = FALSE
    /\ UNCHANGED <<done, archived>>
    /\ Refresh

TheTaskIsGone ==
    /\ ~alive
    /\ UNCHANGED vars

Next ==
    \/ YouTickItOff \/ YouReopenIt \/ YouArchiveIt \/ YouRestoreIt
    \/ YouDeleteIt \/ TheTaskIsGone

Spec == Init /\ [][Next]_vars

\* A live task is on exactly one of the two screens.
OnOneScreenOnly == alive => (board # library)

\* The Library is the archive, and nothing else.
TheLibraryIsTheArchive == library => archived

\* The board is not the archive either.
TheBoardIsNotTheArchive == board => ~archived

====
