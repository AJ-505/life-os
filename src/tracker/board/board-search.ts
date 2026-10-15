import * as z from 'zod'

export const boardSearch = z.object({
  view: z.enum(['calendar']).optional().catch(undefined),
})
