export const CALENDAR_ENABLED = import.meta.env.VITE_ENABLE_CALENDAR === '1'

export const SPACES_ENABLED = import.meta.env.VITE_ENABLE_SPACES === '1'

export const DEV_AUTH_ENABLED =
  import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEV_AUTH === '1'
