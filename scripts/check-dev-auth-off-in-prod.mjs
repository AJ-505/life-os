#!/usr/bin/env node
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
