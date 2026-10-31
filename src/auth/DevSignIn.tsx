import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '#/design-system/ui/button'
import { signInDev } from './dev-session'

export function DevSignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await signInDev(email, password)
    } catch (error) {
      toast.error('Dev sign-in failed.', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-2 border-t pt-4">
      <span className="text-xs text-muted-foreground">
        Dev sign-in: any email, any password
      </span>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        className="h-9 rounded-md border bg-transparent px-3 text-sm"
      />
      <input
        type="password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        className="h-9 rounded-md border bg-transparent px-3 text-sm"
      />
      <Button type="submit" variant="outline" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in (dev)'}
      </Button>
    </form>
  )
}
