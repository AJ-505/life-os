import { execFileSync } from 'node:child_process'

const buildId = process.env.VERCEL_GIT_COMMIT_SHA
if (process.env.VERCEL_ENV !== 'production' || !buildId) process.exit(0)

execFileSync(
  'pnpm',
  ['exec', 'convex', 'run', 'release:publish', JSON.stringify({ buildId })],
  { stdio: 'inherit' },
)
