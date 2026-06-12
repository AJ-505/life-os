import { drizzle } from 'drizzle-orm/node-postgres'

import * as tracker from '#/tracker/schema'

export const db = drizzle(process.env.DATABASE_URL!, {
  schema: { ...tracker },
})
