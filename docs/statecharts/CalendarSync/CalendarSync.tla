---- MODULE CalendarSync ----
\* One personal task and the user's calendar settings, as convex/settings.ts,
\* convex/tracker.ts and convex/calendar.ts handle them. The model keeps one
\* slot of waiting work. A push reads the newest task row when it runs, so a
\* second push behind the first changes nothing.

VARIABLES sync, auto, due, switch, event, issue, work
vars == <<sync, auto, due, switch, event, issue, work>>

Issues == {"none", "limited", "removed"}
Work == {"none", "push", "retry", "cleanup"}

TypeOK ==
    /\ sync \in BOOLEAN /\ auto \in BOOLEAN
    /\ due \in BOOLEAN /\ switch \in BOOLEAN
    /\ event \in BOOLEAN /\ issue \in Issues /\ work \in Work

WantsOf(s, a, d, sw) == s /\ d /\ (sw \/ a)
Wants == WantsOf(sync, auto, due, switch)
Settled == work = "none"

Queue(kind, when) == work' = IF work = "none" /\ when THEN kind ELSE work

Init ==
    /\ sync = FALSE /\ auto = FALSE
    /\ due = FALSE /\ switch = FALSE
    /\ event = FALSE /\ issue = "none" /\ work = "none"

\* scheduleCalendarSync: a calendar field changed, so push when the task
\* wants an event or has one.
SchedulePush(d, sw) == Queue("push", WantsOf(sync, auto, d, sw) \/ event)

\* updateCalendarSettings, off to on. The backfill runs only when "add every
\* dated task" is on, and it skips a task marked deleted in Google.
YouTurnSyncOn ==
    /\ ~sync
    /\ sync' = TRUE
    /\ Queue("retry", auto /\ WantsOf(TRUE, auto, due, switch) /\ ~event /\ issue # "removed")
    /\ UNCHANGED <<auto, due, switch, event, issue>>

\* updateCalendarSettings, on to off: delete every event the user owns.
YouTurnSyncOff ==
    /\ sync
    /\ sync' = FALSE
    /\ work' = IF event THEN "cleanup" ELSE work
    /\ UNCHANGED <<auto, due, switch, event, issue>>

YouTurnAutoAddOn ==
    /\ ~auto
    /\ auto' = TRUE
    /\ Queue("retry", sync /\ WantsOf(sync, TRUE, due, switch) /\ ~event /\ issue # "removed")
    /\ UNCHANGED <<sync, due, switch, event, issue>>

\* continueAutoSyncOff: only tasks without their own switch lose their event.
YouTurnAutoAddOff ==
    /\ auto
    /\ auto' = FALSE
    /\ IF sync /\ ~switch
         THEN /\ work' = IF event THEN "cleanup" ELSE work
              /\ issue' = IF issue = "removed" THEN "none" ELSE issue
         ELSE UNCHANGED <<work, issue>>
    /\ UNCHANGED <<sync, due, switch, event>>

\* Set a date, or reopen a dated task.
YouDateTheTask ==
    /\ ~due
    /\ due' = TRUE
    /\ SchedulePush(TRUE, switch)
    /\ UNCHANGED <<sync, auto, switch, event, issue>>

\* Clear the date, complete the task, or archive it.
YouFinishTheTask ==
    /\ due
    /\ due' = FALSE
    /\ SchedulePush(FALSE, switch)
    /\ UNCHANGED <<sync, auto, switch, event, issue>>

\* TaskCalendarFields enables the switch only with sync on, a date set, and
\* "add every dated task" off. updateTask clears the stored issue when the
\* switch turns on.
SwitchEnabled == sync /\ due /\ ~auto

YouTurnTheSwitchOn ==
    /\ SwitchEnabled /\ ~switch
    /\ switch' = TRUE
    /\ issue' = "none"
    /\ SchedulePush(due, TRUE)
    /\ UNCHANGED <<sync, auto, due, event>>

YouTurnTheSwitchOff ==
    /\ SwitchEnabled /\ switch
    /\ switch' = FALSE
    /\ SchedulePush(due, FALSE)
    /\ UNCHANGED <<sync, auto, due, event, issue>>

\* One run of pushOnce. ok is FALSE when Google answers 429.
RunOutcome(ok) ==
    IF ~Wants /\ ~event THEN /\ issue' = "none" /\ UNCHANGED event
    ELSE IF Wants /\ ~event /\ issue = "removed" THEN UNCHANGED <<event, issue>>
    ELSE IF ok THEN /\ event' = Wants /\ issue' = "none"
    ELSE /\ issue' = "limited" /\ UNCHANGED event

Reaches == (Wants \/ event) /\ ~(Wants /\ ~event /\ issue = "removed")

ThePushRuns ==
    /\ work \in {"push", "retry"}
    /\ work' = "none"
    /\ RunOutcome(TRUE)
    /\ UNCHANGED <<sync, auto, due, switch>>

\* syncTaskForUser with no attempt: a 429 is stored and never retried.
GoogleLimitsThePush ==
    /\ work = "push" /\ Reaches
    /\ work' = "none"
    /\ RunOutcome(FALSE)
    /\ UNCHANGED <<sync, auto, due, switch>>

\* syncTaskForUser with an attempt backs off and tries again. The model leaves
\* out the limit of 3 attempts.
GoogleLimitsTheRetry ==
    /\ work = "retry" /\ Reaches
    /\ work' = "retry"
    /\ RunOutcome(FALSE)
    /\ UNCHANGED <<sync, auto, due, switch>>

\* A PATCH answers 404 or 410: the user deleted the event in Google.
ThePushFindsTheEventDeleted ==
    /\ work \in {"push", "retry"} /\ Wants /\ event
    /\ work' = "none"
    /\ event' = FALSE
    /\ issue' = "removed"
    /\ UNCHANGED <<sync, auto, due, switch>>

\* deleteEventsForUser, then clearEventIds.
TheCleanupDeletesTheEvent ==
    /\ work = "cleanup"
    /\ event' = FALSE
    /\ work' = IF Wants /\ issue # "removed" THEN "push" ELSE "none"
    /\ issue' = IF ~Wants /\ issue = "removed" THEN "none" ELSE issue
    /\ UNCHANGED <<sync, auto, due, switch>>

\* deleteEventsForUser skips any answer but 2xx, 404 and 410, and records nothing.
GoogleRefusesTheCleanup ==
    /\ work = "cleanup"
    /\ work' = "none"
    /\ UNCHANGED <<sync, auto, due, switch, event, issue>>

\* Settings > Repair now: syncTask clears the deleted mark and pushes at once.
YouPressRepair ==
    /\ sync /\ (event \/ (due /\ (switch \/ auto)))
    /\ event' = Wants
    /\ issue' = "none"
    /\ UNCHANGED <<sync, auto, due, switch, work>>

Next ==
    \/ YouTurnSyncOn \/ YouTurnSyncOff \/ YouTurnAutoAddOn \/ YouTurnAutoAddOff
    \/ YouDateTheTask \/ YouFinishTheTask \/ YouTurnTheSwitchOn \/ YouTurnTheSwitchOff
    \/ ThePushRuns \/ GoogleLimitsThePush \/ GoogleLimitsTheRetry
    \/ ThePushFindsTheEventDeleted \/ TheCleanupDeletesTheEvent \/ GoogleRefusesTheCleanup
    \/ YouPressRepair

Spec == Init /\ [][Next]_vars

\* When no work waits, a task that should be on the calendar is there,
\* or the task shows why it is not.
WantedEventArrives == Settled => (Wants => (event \/ issue # "none"))

\* When no work waits, a task that should not be on the calendar has no event
\* left in Google, or the task shows why.
UnwantedEventLeaves == Settled => ((~Wants /\ event) => issue # "none")

\* A rate-limit warning always has a retry waiting.
RateLimitIsRetried == (issue = "limited") => (work = "retry")

====
