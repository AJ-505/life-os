import { cronJobs } from 'convex/server'

import { internal } from './_generated/api'

const crons = cronJobs()

crons.cron(
  'purge stale calendar tasks',
  '0 3 * * *',
  internal.tracker.purgeStaleCalendarTasks,
)

crons.cron(
  'purge stale calendar event cache',
  '10 3 * * *',
  internal.calendarPull.purgeStaleCache,
)

export default crons
