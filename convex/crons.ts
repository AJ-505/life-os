import { cronJobs } from 'convex/server'

import { internal } from './_generated/api'

const crons = cronJobs()

crons.daily(
  'purge stale calendar tasks',
  { hourUTC: 3, minuteUTC: 0 },
  internal.tracker.purgeStaleCalendarTasks,
)

export default crons
