/**
 * school-sync — pull every file from your PAU elearning (Moodle) courses
 * into one local vault folder you can point an AI at.
 *
 * Uses Moodle's mobile web-service API (the same channel the official
 * mobile app uses), so no browser, no captcha:
 *   1. login/token.php            -> wstoken
 *   2. core_webservice_get_site_info
 *   3. core_enrol_get_users_courses
 *   4. core_course_get_contents   -> module files
 *   5. download fileurl?token=...
 *
 * Usage:
 *   pnpm school:sync             # sync enrolled courses
 *   pnpm school:sync -- --dry    # list what would be downloaded
 *
 * Env (in .env.local):
 *   ELEARNING_USERNAME=you@pau.edu.ng
 *   ELEARNING_PASSWORD=...
 *   SCHOOL_VAULT_DIR=~/SchoolVault   (optional)
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { config } from 'dotenv'

config({ path: ['.env.local', '.env'] })

const BASE = process.env.ELEARNING_BASE_URL ?? 'https://elearning.pau.edu.ng'
const USERNAME = process.env.ELEARNING_USERNAME
const PASSWORD = process.env.ELEARNING_PASSWORD
const VAULT = expandHome(
  process.env.SCHOOL_VAULT_DIR ?? path.join(os.homedir(), 'SchoolVault'),
)
const DRY = process.argv.includes('--dry')

function expandHome(p: string) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p
}

function sanitize(name: string) {
  return name
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140)
}

interface ModuleContent {
  type: string
  filename: string
  filepath: string | null
  filesize: number
  fileurl?: string
  timemodified: number
}

interface Module {
  id: number
  name: string
  modname: string
  contents?: Array<ModuleContent>
}

interface Section {
  id: number
  name: string
  modules: Array<Module>
}

interface Course {
  id: number
  shortname: string
  fullname: string
}

type Manifest = Partial<
  Record<string, { timemodified: number; filesize: number; path: string }>
>

let token = ''

async function moodle<T>(
  wsfunction: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const url = new URL(`${BASE}/webservice/rest/server.php`)
  url.searchParams.set('wstoken', token)
  url.searchParams.set('moodlewsrestformat', 'json')
  url.searchParams.set('wsfunction', wsfunction)
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v))
  }
  const res = await fetch(url)
  const data: unknown = await res.json()
  if (data && typeof data === 'object' && 'exception' in data) {
    const message = (data as { message?: string }).message ?? 'unknown error'
    throw new Error(`${wsfunction} failed: ${message}`)
  }
  return data as T
}

async function login() {
  if (!USERNAME || !PASSWORD) {
    console.error(
      'Missing credentials. Add ELEARNING_USERNAME and ELEARNING_PASSWORD to .env.local',
    )
    process.exit(1)
  }
  const url = new URL(`${BASE}/login/token.php`)
  url.searchParams.set('username', USERNAME)
  url.searchParams.set('password', PASSWORD)
  url.searchParams.set('service', 'moodle_mobile_app')
  const res = await fetch(url)
  const data = (await res.json()) as { token?: string; error?: string }
  if (!data.token) {
    throw new Error(`Login failed: ${data.error ?? 'unknown error'}`)
  }
  token = data.token
}

function loadManifest(): Manifest {
  const p = path.join(VAULT, '.manifest.json')
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
  return {}
}

function saveManifest(m: Manifest) {
  fs.writeFileSync(path.join(VAULT, '.manifest.json'), JSON.stringify(m, null, 2))
}

async function downloadFile(fileurl: string, dest: string): Promise<boolean> {
  const url = new URL(fileurl)
  url.searchParams.set('token', token)
  const res = await fetch(url)
  if (!res.ok || !res.body) {
    console.warn(`    ✗ HTTP ${res.status} for ${path.basename(dest)}`)
    return false
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(dest, buf)
  return true
}

async function main() {
  console.log(`school-sync → ${VAULT}${DRY ? '  (dry run)' : ''}\n`)
  await login()

  const site = await moodle<{ userid: number; fullname: string }>(
    'core_webservice_get_site_info',
  )
  console.log(`Signed in as ${site.fullname}\n`)

  const courses = await moodle<Array<Course>>('core_enrol_get_users_courses', {
    userid: site.userid,
  })
  console.log(`Enrolled in ${courses.length} courses\n`)

  fs.mkdirSync(VAULT, { recursive: true })
  const manifest = loadManifest()
  const index: Array<string> = []
  let downloaded = 0
  let skipped = 0
  let failed = 0

  for (const course of courses) {
    const courseDir = sanitize(course.shortname || course.fullname)
    console.log(`▸ ${course.fullname}`)
    index.push(`\n## ${course.fullname}\n`)

    let sections: Array<Section>
    try {
      sections = await moodle<Array<Section>>('core_course_get_contents', {
        courseid: course.id,
      })
    } catch (e) {
      console.warn(`  ✗ could not list contents: ${(e as Error).message}`)
      continue
    }

    for (const section of sections) {
      for (const mod of section.modules) {
        for (const content of mod.contents ?? []) {
          if (content.type !== 'file' || !content.fileurl) continue
          const rel = path.join(
            courseDir,
            sanitize(section.name || 'General'),
            sanitize(mod.name),
            sanitize(content.filename),
          )
          const dest = path.join(VAULT, rel)
          const known = manifest[content.fileurl]
          if (
            known &&
            known.timemodified === content.timemodified &&
            fs.existsSync(path.join(VAULT, known.path))
          ) {
            skipped++
            index.push(`- ${rel}`)
            continue
          }
          if (DRY) {
            console.log(`    would download ${rel}`)
            downloaded++
            continue
          }
          const ok = await downloadFile(content.fileurl, dest)
          if (ok) {
            manifest[content.fileurl] = {
              timemodified: content.timemodified,
              filesize: content.filesize,
              path: rel,
            }
            index.push(`- ${rel}`)
            downloaded++
            console.log(`    ✓ ${rel}`)
          } else {
            failed++
          }
        }
      }
    }
  }

  if (!DRY) {
    saveManifest(manifest)
    const header = `# School Vault\n\nSynced from ${BASE} on ${new Date().toISOString()} for ${site.fullname}.\nEvery file from every enrolled course lives in this folder — point your AI here.\n`
    fs.writeFileSync(path.join(VAULT, 'README.md'), header + index.join('\n'))
  }

  console.log(
    `\nDone. ${downloaded} ${DRY ? 'to download' : 'downloaded'}, ${skipped} already up to date${failed ? `, ${failed} failed` : ''}.`,
  )
  console.log(`Vault: ${VAULT}`)
}

main().catch((e) => {
  console.error(`\n${(e as Error).message}`)
  process.exit(1)
})
