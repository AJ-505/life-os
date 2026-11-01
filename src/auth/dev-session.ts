import { useSyncExternalStore } from 'react'
import * as z from 'zod'

const STORAGE_KEY = 'lifeos-dev-auth-email'

const TokenResponse = z.object({ token: z.string() })

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify() {
  for (const listener of listeners) listener()
}

export function readDevEmail(): string | null {
  return typeof window === 'undefined'
    ? null
    : window.localStorage.getItem(STORAGE_KEY)
}

export function useDevEmail() {
  return useSyncExternalStore(subscribe, readDevEmail, () => null)
}

async function mintToken(email: string, password: string) {
  const site = import.meta.env.VITE_CONVEX_SITE_URL
  const response = await fetch(`${site}/dev-auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) {
    throw new Error(
      `Dev sign-in refused (${response.status}). Is DEV_AUTH_ENABLED set on the Convex deployment?`,
    )
  }
  return TokenResponse.parse(await response.json()).token
}

export async function signInDev(email: string, password: string) {
  await mintToken(email, password)
  window.localStorage.setItem(STORAGE_KEY, email.trim().toLowerCase())
  notify()
}

export function signOutDev() {
  window.localStorage.removeItem(STORAGE_KEY)
  notify()
}

export async function fetchDevToken(email: string) {
  return mintToken(email, 'dev')
}
