import { cronJobs } from 'convex/server'

import { internal } from './_generated/api'

const crons = cronJobs()

crons.daily(
  'purge stale calendar tasks',
  { hourUTC: 3, minuteUTC: 0 },
  internal.tracker.purgeStaleCalendarTasks,
)

crons.daily(
  'purge stale calendar event cache',
  { hourUTC: 3, minuteUTC: 10 },
  internal.calendarPull.purgeStaleCache,
)

export default crons
