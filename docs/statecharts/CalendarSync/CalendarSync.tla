---- MODULE CalendarSync ----
\* One personal task and the user's calendar settings, as convex/settings.ts,
\* convex/calendarSync.ts and convex/calendar.ts handle them. The model keeps
\* one slot of waiting work. A push reads the newest task row when it runs, so
\* a second push behind the first changes nothing. A push also deletes an event
\* that the task no longer wants, so a push takes the slot of a waiting cleanup,
\* and a cleanup behind a push changes nothing.

VARIABLES sync, auto, due, switch, event, issue, work
vars == <<sync, auto, due, switch, event, issue, work>>

Issues == {"none", "limited", "removed", "failed"}
Work == {"none", "push", "cleanup"}

TypeOK ==
    /\ sync \in BOOLEAN /\ auto \in BOOLEAN
    /\ due \in BOOLEAN /\ switch \in BOOLEAN
    /\ event \in BOOLEAN /\ issue \in Issues /\ work \in Work

WantsOf(s, a, d, sw) == s /\ d /\ (sw \/ a)
Wants == WantsOf(sync, auto, due, switch)
Settled == work = "none"

Queue(kind, when) ==
    work' = IF when /\ (work = "none" \/ (kind = "push" /\ work = "cleanup"))
              THEN kind ELSE work

Init ==
    /\ sync = FALSE /\ auto = FALSE
    /\ due = FALSE /\ switch = FALSE
    /\ event = FALSE /\ issue = "none" /\ work = "none"

\* afterTaskWrite: a calendar field changed, so push when the task wants an
\* event or has one.
SchedulePush(d, sw) == Queue("push", WantsOf(sync, auto, d, sw) \/ event)

\* afterSettingsChange, off to on: the backfill sweep pushes every task that
\* wants an event and has none, by its own switch or by "add every dated
\* task". It skips a task marked deleted in Google.
YouTurnSyncOn ==
    /\ ~sync
    /\ sync' = TRUE
    /\ Queue("push", WantsOf(TRUE, auto, due, switch) /\ ~event /\ issue # "removed")
    /\ UNCHANGED <<auto, due, switch, event, issue>>

\* afterSettingsChange, on to off: the removeAll sweep deletes every event
\* the user owns.
YouTurnSyncOff ==
    /\ sync
    /\ sync' = FALSE
    /\ Queue("cleanup", event)
    /\ UNCHANGED <<auto, due, switch, event, issue>>

YouTurnAutoAddOn ==
    /\ ~auto
    /\ auto' = TRUE
    /\ Queue("push", sync /\ WantsOf(sync, TRUE, due, switch) /\ ~event /\ issue # "removed")
    /\ UNCHANGED <<sync, due, switch, event, issue>>

\* The removeAutoAdded sweep: only tasks without their own switch lose their
\* event.
YouTurnAutoAddOff ==
    /\ auto
    /\ auto' = FALSE
    /\ IF sync /\ ~switch
         THEN /\ Queue("cleanup", event)
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
    /\ work = "push"
    /\ work' = "none"
    /\ RunOutcome(TRUE)
    /\ UNCHANGED <<sync, auto, due, switch>>

\* syncTaskForUser stores the 429, backs off and tries again, for every push.
\* The model leaves out the limit of 3 attempts.
GoogleLimitsThePush ==
    /\ work = "push" /\ Reaches
    /\ work' = "push"
    /\ RunOutcome(FALSE)
    /\ UNCHANGED <<sync, auto, due, switch>>

\* A PATCH answers 404 or 410: the user deleted the event in Google.
ThePushFindsTheEventDeleted ==
    /\ work = "push" /\ Wants /\ event
    /\ work' = "none"
    /\ event' = FALSE
    /\ issue' = "removed"
    /\ UNCHANGED <<sync, auto, due, switch>>

\* deleteEventsForUser, then clearEventIds. A task that no longer wants an
\* event loses any stored issue.
TheCleanupDeletesTheEvent ==
    /\ work = "cleanup"
    /\ event' = FALSE
    /\ work' = IF Wants /\ issue # "removed" THEN "push" ELSE "none"
    /\ issue' = IF Wants THEN issue ELSE "none"
    /\ UNCHANGED <<sync, auto, due, switch>>

\* deleteEventsForUser backs off and tries again on a 429 or a Google error,
\* which the model shows as no step. On any other refusal, markRemovalFailed
\* stores the reason on the task that still holds the event.
GoogleRefusesTheCleanup ==
    /\ work = "cleanup"
    /\ work' = "none"
    /\ issue' = IF event THEN "failed" ELSE issue
    /\ UNCHANGED <<sync, auto, due, switch, event>>

\* Settings > Repair now: repairCalendar clears the deleted mark and pushes
\* every synced task at once.
YouPressRepair ==
    /\ sync /\ (event \/ (due /\ (switch \/ auto)))
    /\ event' = Wants
    /\ issue' = "none"
    /\ UNCHANGED <<sync, auto, due, switch, work>>

Next ==
    \/ YouTurnSyncOn \/ YouTurnSyncOff \/ YouTurnAutoAddOn \/ YouTurnAutoAddOff
    \/ YouDateTheTask \/ YouFinishTheTask \/ YouTurnTheSwitchOn \/ YouTurnTheSwitchOff
    \/ ThePushRuns \/ GoogleLimitsThePush
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
RateLimitIsRetried == (issue = "limited") => (work = "push")

====
