/**
 * WIP feature gates. Calendar sync and Spaces exist in code but are not ready
 * to ship, so their UI hides while bugfixes ride the same deploys.
 *
 * Default off. Flip per environment with no code change:
 *   VITE_ENABLE_CALENDAR=1
 *   VITE_ENABLE_SPACES=1
 *
 * The gated code paths stay intact (hooks still run, mutations still exist),
 * so turning a flag on restores the exact same behavior.
 */
export const CALENDAR_ENABLED =
  import.meta.env.VITE_ENABLE_CALENDAR === '1'

export const SPACES_ENABLED = import.meta.env.VITE_ENABLE_SPACES === '1'
