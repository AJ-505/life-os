/**
 * WIP feature gates. Calendar sync and Spaces exist in code but are not ready
 * to ship, so their UI hides while bugfixes ride the same deploys.
 *
 * Default off. Vite inlines these at build time, so flipping one needs a
 * rebuild, not just a redeploy:
 *   VITE_ENABLE_CALENDAR=1
 *   VITE_ENABLE_SPACES=1
 *
 * A gated build mounts none of the gated components, so it makes no calendar
 * or spaces query at all. The reads and mutations live in children that only
 * render when the flag is on.
 */
export const CALENDAR_ENABLED = import.meta.env.VITE_ENABLE_CALENDAR === '1'

export const SPACES_ENABLED = import.meta.env.VITE_ENABLE_SPACES === '1'
