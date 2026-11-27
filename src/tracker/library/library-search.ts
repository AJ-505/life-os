import * as z from 'zod'

export const LIBRARY_TABS = ['shelf', 'done', 'archive'] as const

export type LibraryTab = (typeof LIBRARY_TABS)[number]

export const librarySearch = z.object({
  tab: z.enum(LIBRARY_TABS).optional().catch(undefined),
})
