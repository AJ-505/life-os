import { createFileRoute } from '@tanstack/react-router'

/**
 * shoo redirects here after Google sign-in. The token exchange is handled
 * automatically by shoo's adapter (mounted in router.tsx via
 * ConvexProviderWithAuth → useAuth → handleCallback), which then redirects to
 * the app. This route just exists so the redirect URL resolves cleanly.
 */
export const Route = createFileRoute('/shoo/callback')({
  component: () => (
    <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
      Signing you in…
    </div>
  ),
})
