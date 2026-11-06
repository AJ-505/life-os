#!/usr/bin/env node
/**
 * Fails a production build when any DEV_AUTH_ variable is set on the production
 * Convex deployment.
 *
 * Dev sign-in mints tokens from a shared password, so its variables must exist
 * only on the dev deployment. Runs only when VERCEL_ENV is production. Previews
 * and local runs print a note and pass, because they do not deploy to prod.
 *
 * `--require` runs the check outside Vercel production too. `convex:deploy` uses
 * it, because that script always targets production.
 *
 * The env listing targets the deployment that CONVEX_DEPLOY_KEY selects. Without
 * that key the listing falls back to `--prod`. Only variable names are printed.
 *
 *   VERCEL_ENV=production node scripts/check-dev-auth-off-in-prod.mjs
 *   node scripts/check-dev-auth-off-in-prod.mjs --require
 *
 * Exit codes: 0 clean or skipped, 1 a DEV_AUTH_ variable is set on production,
 * 2 the production env could not be listed (fails closed).
 */
import { execFileSync } from 'node:child_process'

const PREFIX = 'DEV_AUTH_'

const required = process.argv.includes('--require')

if (!required && process.env.VERCEL_ENV !== 'production') {
  console.log(
    `check-dev-auth-off-in-prod: skipped (VERCEL_ENV=${process.env.VERCEL_ENV ?? 'unset'}, not a production build)`,
  )
  process.exit(0)
}

function listEnvOutput() {
  const args = ['exec', 'convex', 'env', 'list']
  if (!process.env.CONVEX_DEPLOY_KEY) args.push('--prod')
  try {
    return execFileSync('pnpm', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    console.error(
      'check-dev-auth-off-in-prod: could not list the production Convex env. Failing closed. Check CONVEX_DEPLOY_KEY or the Convex login.',
    )
    process.exit(2)
  }
}

function variableNames(output) {
  const assignments = output.split('\n').filter((line) => line.includes('='))
  if (assignments.length === 0) {
    console.error(
      'check-dev-auth-off-in-prod: the production env listing had no NAME=value lines. Failing closed.',
    )
    process.exit(2)
  }
  return assignments.map((line) => line.split('=')[0].trim())
}

const leaked = variableNames(listEnvOutput()).filter((name) =>
  name.startsWith(PREFIX),
)

if (leaked.length > 0) {
  console.error(
    `check-dev-auth-off-in-prod: ${leaked.join(', ')} set on production. Remove it with: pnpm exec convex env remove --prod <NAME>`,
  )
  process.exit(1)
}

console.log('check-dev-auth-off-in-prod: no DEV_AUTH_ variables on production')
