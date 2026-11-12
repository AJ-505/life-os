# CalendarSync

TLC reached 256 states and 1189 steps. The chart draws 8 states and 29 arrows.
The chart does not draw 706 steps that stay in one chart state.

## RateLimitIsRetried breaks
The shortest path has 4 steps:
0. Not on the calendar
1. you turn auto-add on: Not on the calendar
2. you turn sync on: Not on the calendar
3. you give it a date: Waiting to be added
4. Google rate-limits: Rate limited, nothing retries

## UnwantedEventLeaves breaks
The shortest path has 6 steps:
0. Not on the calendar
1. you give it a date: Not on the calendar
2. you turn auto-add on: Not on the calendar
3. you turn sync on: Waiting to be added
4. the push runs: On the calendar
5. you turn sync off: Waiting to be removed
6. Google refuses: Left behind in Google

## WantedEventArrives breaks
The shortest path has 6 steps:
0. Not on the calendar
1. you give it a date: Not on the calendar
2. you turn sync on: Not on the calendar
3. you give it a date: Waiting to be added
4. you turn sync off: Not on the calendar
5. the push runs: Not on the calendar
6. you turn sync on: Missing, nothing adds it

## Rules that hold
TypeOK, NoDeadlock
