#!/usr/bin/env node
/**
 * Does the deployed front end still match the deployed backend?
 *
 * The outage this script exists for: the live bundle at lifeos-track.vercel.app
 * was built before Spaces and calls `tracker:getBoard` with no arguments, while
 * the backend had been pushed with a required `spaceId`. Convex validates
 * arguments before it runs a handler and rejects unknown fields, so every user
 * got an ArgumentValidationError and the app never loaded.
 *
 * The check fetches the live chunks, extracts every public Convex function they
 * reference, and replays the exact argument object that client sends against the
 * deployment. A newly required field, or a field that no longer exists, fails.
 *
 *   node scripts/check-convex-contract.mjs
 *   node scripts/check-convex-contract.mjs --url https://lifeos-track.vercel.app
 *
 * Read only: every probe is unauthenticated, so a mutation cannot write.
 */
import { readFileSync } from 'node:fs'
import { setDefaultResultOrder } from 'node:dns'

// This host's IPv6 route to Cloudflare drops connections often enough to fail
// the check at random. Prefer A records so a clean run means a clean contract.
setDefaultResultOrder('ipv4first')

const args = process.argv.slice(2)
const urlFlag = args.indexOf('--url')
const APP = urlFlag >= 0 ? args[urlFlag + 1] : 'https://lifeos-track.vercel.app'

/**
 * What the deployed client sends, per public function. `null` means it sends no
 * arguments at all, which is a distinct fact from "it sends an empty object".
 * Values are typed the way the client sends them.
 */
const LIVE_CLIENT_SENDS = {
  // `null` means the client sends no arguments at all, which is a distinct fact
  // from an empty object. Every entry is the full argument set that client can
  // send for that function, because a subset cannot catch a removed field.
  'tracker:getBoard': null,
  'tracker:createProject': {
    id: 'contract-probe',
    name: 'contract probe',
    color: 'moss',
    gridCol: 0,
    gridRow: 0,
  },
  'tracker:updateProject': {
    id: 'contract-probe',
    name: 'contract probe',
    color: 'moss',
    collapsed: false,
    showDone: false,
    targetDate: null,
  },
  'tracker:moveProject': { id: 'contract-probe', gridCol: 0, gridRow: 0 },
  'tracker:setProjectStatus': { id: 'contract-probe', status: 'active' },
  'tracker:deleteProject': { id: 'contract-probe' },
  'tracker:createTask': {
    id: 'contract-probe',
    projectId: 'contract-probe',
    title: 'contract probe',
    position: 0,
    dueAt: null,
  },
  'tracker:updateTask': {
    id: 'contract-probe',
    title: 'contract probe',
    notes: null,
    done: false,
    archived: false,
    dueAt: null,
    reminderMinutes: null,
    addToCalendar: false,
  },
  'tracker:moveTask': {
    id: 'contract-probe',
    projectId: 'contract-probe',
    position: 0,
  },
  'tracker:setTaskFocus': { id: 'contract-probe', inFocus: false },
  'tracker:deleteTask': { id: 'contract-probe' },
  'settings:getCalendarSettings': null,
  // The dialog writes one at a time; sending both covers both.
  'settings:updateCalendarSettings': {
    syncEnabled: false,
    defaultReminderMinutes: 15,
  },
  'calendar:syncTask': { taskId: 'contract-probe' },
  'backup:exportBackup': null,
  // A non-empty element, so Convex actually validates the task shape. Empty
  // arrays are never validated and hid a whole class of break.
  'backup:importBackup': {
    app: 'lifeos',
    version: 1,
    exportedAt: '2026-01-01T00:00:00.000Z',
    projects: [
      {
        id: 'contract-probe',
        name: 'contract probe',
        color: 'moss',
        status: 'active',
        collapsed: false,
        gridCol: 0,
        gridRow: 0,
        targetDate: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        finishedAt: null,
        shelvedAt: null,
      },
    ],
    tasks: [
      {
        id: 'contract-probe',
        projectId: 'contract-probe',
        parentId: null,
        title: 'contract probe',
        notes: null,
        position: 0,
        done: false,
        doneAt: null,
        archived: false,
        dueAt: null,
        inFocus: false,
        focusOrder: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  },
  'spaces:getMySpaces': null,
  // The rebuilt live bundle (6013fca) reaches these three as well. Unknown
  // fields are rejected, so a shape change on any of them breaks the deployed
  // client exactly like a missing required field does.
  'spaces:getSpaceMembers': { spaceId: 'contract-probe' },
  'spaces:deleteSpace': { spaceId: 'contract-probe' },
  'spaces:leaveSpace': { spaceId: 'contract-probe' },
  'spaces:createSpace': {
    name: 'contract probe',
    id: 'contract-probe',
    inviteCode: 'PROBE',
  },
  'spaces:joinSpaceByCode': { inviteCode: 'PROBE' },
}

/** Which endpoint a function lives on. Actions answer only on /api/action, and
 *  asking the wrong one returns "defined as Action" rather than a validation
 *  verdict, which would read as a pass. */
const ACTIONS = new Set(['calendar:syncTask'])

function deployment() {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  const line = env.split('\n').find((l) => l.startsWith('VITE_CONVEX_URL='))
  if (!line) throw new Error('VITE_CONVEX_URL is not in .env.local')
  return line.slice('VITE_CONVEX_URL='.length).trim().replace(/\/$/, '')
}

/**
 * A fetch that survives a flaky network. Without this the check dies on one
 * dropped connection, which reads as "unknown" rather than "clean".
 */
async function get(url, init) {
  let last
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await fetch(url, init)
    } catch (error) {
      last = error
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt))
    }
  }
  throw last
}

async function chunks() {
  const html = await (await get(APP)).text()
  // Both forms appear in a Vite build: `/assets/x.js` in the HTML, and a bare
  // `assets/x.js` inside the preload manifest a chunk carries. Matching only the
  // leading-slash form is what made an earlier check miss every route chunk.
  const ASSET = /(?:\/)?assets\/[\w.-]+\.js/g
  const found = new Set(
    [...html.matchAll(ASSET)].map((m) =>
      m[0].startsWith('/') ? m[0] : '/' + m[0],
    ),
  )
  // Route chunks are referenced from other chunks, not from the HTML, so crawl
  // transitively until the set stops growing.
  const seen = new Set()
  // Crawl until the set stops growing. A fixed pass count can silently miss a
  // chunk, and a missed chunk is a missed contract.
  for (let pass = 0; pass < 25; pass++) {
    const next = [...found].filter((c) => !seen.has(c))
    if (next.length === 0) break
    for (const chunk of next) {
      seen.add(chunk)
      const res = await get(APP + chunk)
      if (!res.ok) continue
      const src = await res.text()
      for (const m of src.matchAll(ASSET))
        found.add(m[0].startsWith('/') ? m[0] : '/' + m[0])
    }
  }
  return [...found]
}

async function referencedFunctions() {
  const refs = new Set()
  for (const chunk of await chunks()) {
    const res = await get(APP + chunk)
    if (!res.ok) continue
    const src = await res.text()
    // `$` is a legal identifier character in a minified bundle.
    for (const m of src.matchAll(
      /\b(?:api\.)?[$A-Za-z_][$\w]*\.(tracker|spaces|settings|calendar|backup)\.([A-Za-z_$]\w*)/g,
    )) {
      refs.add(`${m[1]}:${m[2]}`)
    }
    // Minified builds also carry the bare function name beside its module.
    for (const m of src.matchAll(
      /\b(tracker|spaces|settings|calendar|backup)\b/g,
    )) {
      void m
    }
  }
  return [...refs].sort()
}

async function call(convexUrl, kind, path, body) {
  const res = await get(`${convexUrl}/api/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path,
      args: body === null ? {} : body,
      format: 'json',
    }),
  })
  const json = await res.json().catch(() => ({}))
  return String(json.errorMessage ?? json.status ?? '')
}

async function probe(convexUrl, path, body) {
  if (ACTIONS.has(path)) return await call(convexUrl, 'action', path, body)
  const kind = /^get|^export|^list/.test(path.split(':')[1])
    ? 'query'
    : 'mutation'
  const answer = await call(convexUrl, kind, path, body)
  // Belt and braces: if the kind map is stale, retry where the function lives
  // rather than reporting a pass on an answer we never got.
  if (answer.includes('defined as Action'))
    return await call(convexUrl, 'action', path, body)
  return answer
}

const convexUrl = deployment()
const functions = await referencedFunctions()
console.log(`front end : ${APP}`)
console.log(`backend   : ${convexUrl}`)
console.log(
  `reachable : ${functions.length} public function(s) across ${(await chunks()).length} chunk(s)\n`,
)

let failures = 0
for (const path of functions) {
  if (!(path in LIVE_CLIENT_SENDS)) {
    failures++
    console.log(
      `FAIL    ${path.padEnd(34)} reachable from the live bundle but not recorded in LIVE_CLIENT_SENDS`,
    )
    continue
  }
  const answer = await probe(convexUrl, path, LIVE_CLIENT_SENDS[path])
  const missing = answer.match(/missing the required field `(\w+)`/)
  const extra = answer.match(/contains extra field `(\w+)`/)
  if (missing || extra) {
    failures++
    console.log(
      `FAIL    ${path.padEnd(34)} ${missing ? `now requires '${missing[1]}'` : `no longer accepts '${extra[1]}'`}`,
    )
  } else {
    console.log(`ok      ${path.padEnd(34)} contract holds`)
  }
}

console.log()
if (failures) {
  console.log(
    `${failures} contract break(s). Making an argument required, or removing one, breaks every client still built against the old shape.`,
  )
  process.exit(1)
}
console.log('No contract breaks.')
