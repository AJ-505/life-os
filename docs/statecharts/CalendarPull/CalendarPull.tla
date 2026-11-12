---- MODULE CalendarPull ----
\* The gate that decides when an open Calendar view re-reads Google, from
\* src/tracker/calendar/pull.ts, and the pull it calls in
\* convex/calendarPull.ts. The model keeps one shown window. Looking at the
\* other week forgets what this one had fetched, which is what the client
\* does for a window it has never seen.

VARIABLES covered, fetched, age, running
vars == <<covered, fetched, age, running>>

Ages == {"under10s", "under5min", "over5min"}

TypeOK ==
    /\ covered \in BOOLEAN
    /\ fetched \in BOOLEAN
    /\ age \in Ages
    /\ running \in BOOLEAN

\* A covered window waits five minutes; a window no pull has spanned waits
\* only the ten second navigation gap.
Allowed ==
    /\ ~running
    /\ (age = "over5min" \/ (age = "under5min" /\ ~covered))

Init ==
    /\ covered = FALSE
    /\ fetched = FALSE
    /\ age = "over5min"
    /\ running = FALSE

TheClockAdvances ==
    \/ /\ age = "under10s"
       /\ age' = "under5min"
       /\ UNCHANGED <<covered, fetched, running>>
    \/ /\ age = "under5min"
       /\ age' = "over5min"
       /\ UNCHANGED <<covered, fetched, running>>

\* You look at the other week. A pull in flight is not modelled: the model
\* keeps one window's stamp, and the real stamp carries the window bounds.
YouOpenAnotherWeek ==
    /\ ~running
    /\ covered' = FALSE
    /\ fetched' = FALSE
    /\ UNCHANGED <<age, running>>

\* The stamp is written before the run, so a slow pull cannot queue itself
\* behind every render. This is the line the failure rule turns on.
TheViewAsksGoogle ==
    /\ Allowed
    /\ running' = TRUE
    /\ covered' = TRUE
    /\ age' = "under10s"
    /\ UNCHANGED fetched

\* The pull writes its rows and prunes what the window no longer holds.
ThePullSucceeds ==
    /\ running
    /\ running' = FALSE
    /\ fetched' = TRUE
    /\ UNCHANGED <<covered, age>>

\* Any refusal: not connected, no scope, no timezone, rate limited, a Google
\* error. The toast says why; nothing is written.
ThePullFails ==
    /\ running
    /\ running' = FALSE
    /\ UNCHANGED <<covered, fetched, age>>

Next ==
    \/ TheClockAdvances \/ YouOpenAnotherWeek \/ TheViewAsksGoogle
    \/ ThePullSucceeds \/ ThePullFails

Spec == Init /\ [][Next]_vars

\* A window the cache calls covered is a window whose pull reached Google and
\* came back. A failure leaves the window unfetched.
ACoveredWindowWasFetched == (covered /\ ~running) => fetched

====
