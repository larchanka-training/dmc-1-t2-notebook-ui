import { useEffect, type ReactNode } from 'react'
import { urlAtom } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { accessTokenAtom, userAtom } from '@/entities/session'

/**
 * Wraps protected route content. Unauthenticated users are redirected to
 * /login?from=<current-path> (replace, so Back doesn't loop back here).
 * Returns null while redirecting to prevent a flash of protected content.
 */
export const AuthRouteGuard = reatomComponent(({ children }: { children: ReactNode }) => {
  const isAuthenticated = accessTokenAtom() !== null && userAtom() !== null
  const pathname = urlAtom().pathname

  useEffect(() => {
    if (isAuthenticated) return
    // Use location.replace (same pattern as onSessionExpired in setup.ts):
    // urlAtom.set() requires an active Reatom frame which isn't available
    // inside useEffect — window.location.replace is the reliable fallback.
    window.location.replace(`/login?from=${encodeURIComponent(pathname)}`)
  }, [isAuthenticated, pathname])

  if (!isAuthenticated) return null
  return <>{children}</>
}, 'AuthRouteGuard')
