import { useEffect, type ReactNode } from 'react'
import { urlAtom } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { authStatusAtom } from '@/entities/session'
import { LOGIN_PATH } from '@/shared/lib/paths'

/**
 * Wraps protected route content. Unauthenticated users are redirected to
 * /login?from=<current-path> (replace, so Back doesn't loop back here).
 * Returns null while redirecting or while waiting for the initial /auth/me
 * fetch to settle (tokens present but user not yet hydrated).
 *
 * Reads the single derived `authStatusAtom` instead of re-deriving the
 * token/user/restored triple here (one source of truth across the guard, the
 * login page and the boot gate).
 */
export const AuthRouteGuard = reatomComponent(({ children }: { children: ReactNode }) => {
  const status = authStatusAtom()
  const pathname = urlAtom().pathname

  useEffect(() => {
    // Only redirect once the status is a settled 'anonymous'. 'pending' (initial
    // /auth/me still in flight) must wait, 'authenticated' stays.
    if (status !== 'anonymous') return
    // Use location.replace (same pattern as onSessionExpired in setup.ts):
    // urlAtom.set() requires an active Reatom frame which isn't available
    // inside useEffect — window.location.replace is the reliable fallback.
    window.location.replace(`${LOGIN_PATH}?from=${encodeURIComponent(pathname)}`)
  }, [status, pathname])

  if (status !== 'authenticated') return null
  return <>{children}</>
}, 'AuthRouteGuard')
