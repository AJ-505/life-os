import { useSyncExternalStore } from 'react'
import * as z from 'zod'

const STORAGE_KEY = 'lifeos-dev-auth'

const Credentials = z.object({ email: z.string(), password: z.string() })
const TokenResponse = z.object({ token: z.string() })

export type DevCredentials = z.infer<typeof Credentials>

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify() {
  for (const listener of listeners) listener()
}

function readStored(): string | null {
  return typeof window === 'undefined'
    ? null
    : window.localStorage.getItem(STORAGE_KEY)
}

function parseStored(raw: string | null): DevCredentials | null {
  if (raw === null) return null
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = Credentials.safeParse(json)
  return parsed.success ? parsed.data : null
}

export function readDevCredentials() {
  return parseStored(readStored())
}

export function useDevCredentials() {
  return parseStored(useSyncExternalStore(subscribe, readStored, () => null))
}

export async function fetchDevToken(credentials: DevCredentials) {
  const response = await fetch(
    `${import.meta.env.VITE_CONVEX_SITE_URL}/dev-auth/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    },
  )
  if (response.status === 401) throw new Error('Wrong dev password.')
  if (!response.ok) {
    throw new Error(
      `Dev sign-in refused (${response.status}). Is DEV_AUTH_ENABLED set on the Convex dev deployment?`,
    )
  }
  return TokenResponse.parse(await response.json()).token
}

export async function signInDev(email: string, password: string) {
  const credentials = { email: email.trim().toLowerCase(), password }
  await fetchDevToken(credentials)
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials))
  notify()
}

export function signOutDev() {
  window.localStorage.removeItem(STORAGE_KEY)
  notify()
}
