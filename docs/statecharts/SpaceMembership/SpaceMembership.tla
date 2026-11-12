---- MODULE SpaceMembership ----
EXTENDS Naturals
\* One shared space, as convex/spaces.ts moves it: who belongs, who owns it,
\* which invite link works, and what happens to the work a person held when
\* their membership ends. The reader of the chart is one of the two people.

VARIABLES space, me, other, owner, held, fails, assigned
vars == <<space, me, other, owner, held, fails, assigned>>

TypeOK ==
    /\ space \in BOOLEAN
    /\ me \in {"none", "member"}
    /\ other \in {"none", "member"}
    /\ owner \in {"none", "U", "V"}
    /\ held \in BOOLEAN
    /\ fails \in 0..3
    /\ assigned \in BOOLEAN

\* Three wrong codes close the window. The row that counts them is the same
\* row that holds the lockout, so there is one number, not two.
LockedOut == fails = 3

Init ==
    /\ space = FALSE
    /\ me = "none" /\ other = "none" /\ owner = "none"
    /\ held = FALSE /\ fails = 0 /\ assigned = FALSE

YouCreateTheSpace ==
    /\ ~space
    /\ space' = TRUE
    /\ me' = "member" /\ owner' = "U" /\ held' = TRUE
    /\ UNCHANGED <<other, fails, assigned>>

ATeammateCreatesTheSpace ==
    /\ ~space
    /\ space' = TRUE
    /\ other' = "member" /\ owner' = "V"
    /\ UNCHANGED <<me, held, fails, assigned>>

\* The link reaches you, from the creator or from anyone already inside.
YouGetTheLink ==
    /\ space /\ ~held
    /\ held' = TRUE
    /\ UNCHANGED <<space, me, other, owner, fails, assigned>>

\* Opening a link that resolves. Re-opening the link of a space you are
\* already in does not burn an attempt, so it is not a step here.
YouOpenTheLink ==
    /\ space /\ held /\ me = "none" /\ ~LockedOut
    /\ me' = "member"
    /\ fails' = 0
    /\ UNCHANGED <<space, other, owner, held, assigned>>

\* A code that does not resolve spends one of the three attempts.
YouPasteAWrongCode ==
    /\ space /\ ~LockedOut
    /\ fails' = fails + 1
    /\ UNCHANGED <<space, me, other, owner, held, assigned>>

TheLockoutEnds ==
    /\ LockedOut
    /\ fails' = 0
    /\ UNCHANGED <<space, me, other, owner, held, assigned>>

\* A task in the space is put in your name.
ATeammateAssignsYouATask ==
    /\ me = "member" /\ ~assigned
    /\ assigned' = TRUE
    /\ UNCHANGED <<space, me, other, owner, held, fails>>

\* Falling out of the space always drops the work that was in your name.
YouLeave ==
    /\ space /\ me = "member"
    /\ ~(owner = "U" /\ other = "none")
    /\ me' = "none"
    /\ assigned' = FALSE
    /\ IF owner = "U"
         THEN /\ owner' = "V"
              /\ held' = FALSE
         ELSE UNCHANGED <<owner, held>>
    /\ UNCHANGED <<space, other, fails>>

\* The owner leaves. The longest-standing member takes the space and the
\* link is rotated, so the person who left cannot walk back in.
TheOtherPersonLeavesAsOwner ==
    /\ space /\ owner = "V" /\ me = "member" /\ other = "member"
    /\ other' = "none" /\ owner' = "U" /\ held' = FALSE
    /\ UNCHANGED <<space, me, fails, assigned>>

\* Removing one person drops their membership, their assignments, and the
\* link they hold.
TheOwnerRemovesYou ==
    /\ space /\ owner = "V" /\ me = "member"
    /\ me' = "none" /\ held' = FALSE /\ assigned' = FALSE
    /\ UNCHANGED <<space, other, owner, fails>>

YouDeleteTheSpace ==
    /\ space /\ owner = "U"
    /\ space' = FALSE
    /\ me' = "none" /\ other' = "none" /\ owner' = "none"
    /\ held' = FALSE /\ assigned' = FALSE
    /\ UNCHANGED fails

\* The scheduled pass that clears the removed person's assignments.
TheUnassignPassRuns ==
    /\ me = "none" /\ assigned
    /\ assigned' = FALSE
    /\ UNCHANGED <<space, me, other, owner, held, fails>>

NoSpace ==
    /\ ~space
    /\ UNCHANGED vars

Next ==
    \/ YouCreateTheSpace \/ ATeammateCreatesTheSpace \/ YouGetTheLink
    \/ YouOpenTheLink \/ YouPasteAWrongCode \/ TheLockoutEnds
    \/ ATeammateAssignsYouATask \/ YouLeave \/ TheOtherPersonLeavesAsOwner
    \/ TheOwnerRemovesYou \/ YouDeleteTheSpace \/ TheUnassignPassRuns
    \/ NoSpace

Spec == Init /\ [][Next]_vars

\* While a space exists it has exactly one owner, and that owner is inside.
OneOwner ==
    space => (owner = "U" /\ me = "member") \/ (owner = "V" /\ other = "member")

\* Work never keeps naming someone who fell out of the space.
NoWorkFollowsALeaver == me = "none" => ~assigned

====
