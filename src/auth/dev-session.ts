import * as z from 'zod'

import { jsonCodec, storedValue, useStored } from '#/design-system/stored'

const Credentials = z.object({ email: z.string(), password: z.string() })
const TokenResponse = z.object({ token: z.string() })

export type DevCredentials = z.infer<typeof Credentials>

const credentials = storedValue<DevCredentials | null>(
  'lifeos-dev-auth',
  jsonCodec(Credentials.nullable()),
  null,
)

export function readDevCredentials() {
  return credentials.read()
}

export function useDevCredentials() {
  return useStored(credentials)[0]
}

export async function fetchDevToken(devCredentials: DevCredentials) {
  const response = await fetch(
    `${import.meta.env.VITE_CONVEX_SITE_URL}/dev-auth/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(devCredentials),
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
  const next = { email: email.trim().toLowerCase(), password }
  await fetchDevToken(next)
  credentials.write(next)
}

export function signOutDev() {
  credentials.clear()
}
