import { useEffect, type ReactNode } from 'react'
import { urlAtom } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { accessTokenAtom, sessionRestoredAtom, userAtom } from '@/entities/session'

/**
 * Wraps protected route content. Unauthenticated users are redirected to
 * /login?from=<current-path> (replace, so Back doesn't loop back here).
 * Returns null while redirecting or while waiting for the initial /auth/me
 * fetch to settle (tokens present but user not yet hydrated).
 */
export const AuthRouteGuard = reatomComponent(({ children }: { children: ReactNode }) => {
  const isRestored = sessionRestoredAtom()
  const hasToken = accessTokenAtom() !== null
  const hasUser = userAtom() !== null
  const isAuthenticated = hasToken && hasUser
  // Tokens present but user not yet loaded — wait for loadCurrentUserAction to finish.
  const isPendingRestore = hasToken && !hasUser && !isRestored
  const pathname = urlAtom().pathname

  useEffect(() => {
    if (isPendingRestore || isAuthenticated) return
    if (!isRestored) return
    // Use location.replace (same pattern as onSessionExpired in setup.ts):
    // urlAtom.set() requires an active Reatom frame which isn't available
    // inside useEffect — window.location.replace is the reliable fallback.
    window.location.replace(`/login?from=${encodeURIComponent(pathname)}`)
  }, [isPendingRestore, isAuthenticated, isRestored, pathname])

  if (isPendingRestore || !isAuthenticated) return null
  return <>{children}</>
}, 'AuthRouteGuard')
