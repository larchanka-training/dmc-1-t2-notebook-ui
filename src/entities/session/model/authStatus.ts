import { computed } from '@reatom/core'
import { accessTokenAtom, sessionRestoredAtom, userAtom } from './session'

/**
 * The single, derived auth-state of the app:
 *   - `authenticated` — a token AND a hydrated user are present.
 *   - `pending`       — a token is present but the user is not hydrated yet AND
 *                       the initial `/auth/me` restore has not settled. This is
 *                       the brief post-reload window where we must NOT redirect
 *                       to login (the session may still be valid).
 *   - `anonymous`     — everything else (signed out, or the restore settled
 *                       without a user).
 *
 * One source of truth so the route guard, the login page and the boot gate all
 * agree on "is the user signed in?" instead of each re-deriving it from the raw
 * `accessTokenAtom`/`userAtom`/`sessionRestoredAtom` triple (which drifted and
 * was easy to get subtly wrong). A pure `computed` — it performs no I/O and does
 * NOT trigger any fetch.
 */
export type AuthStatus = 'pending' | 'authenticated' | 'anonymous'

export const authStatusAtom = computed<AuthStatus>(() => {
  const hasToken = accessTokenAtom() !== null
  const hasUser = userAtom() !== null
  if (hasToken && hasUser) return 'authenticated'
  if (hasToken && !hasUser && !sessionRestoredAtom()) return 'pending'
  return 'anonymous'
}, 'session.authStatus')
