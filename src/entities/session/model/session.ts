import { action, atom, withLocalStorage } from '@reatom/core'
import type { auth as authApi } from '@/shared/api'

// Single source of truth for the localStorage keys, shared by the persisted
// atoms below, the boot seeding in setup.ts, and the cross-tab sync
// (`crossTabSync.ts`). A literal typo in any one place would silently break
// persistence or sync, so they all reference these constants.
export const SESSION_STORAGE_KEYS = {
  accessToken: 'session.accessToken',
  refreshToken: 'session.refreshToken',
  user: 'session.user',
} as const

// subscribe: false switches withLocalStorage from reactive-subscription mode to
// withInit mode — atoms are initialised from localStorage on first read inside
// any Reatom frame (including action bodies at startup), rather than waiting for
// a component subscription. Cross-tab atom sync is handled explicitly and
// echo-safely in `crossTabSync.ts` (started from setup.ts).
export const accessTokenAtom = atom<string | null>(null, 'session.accessToken').extend(
  withLocalStorage({ key: SESSION_STORAGE_KEYS.accessToken, subscribe: false }),
)

export const refreshTokenAtom = atom<string | null>(null, 'session.refreshToken').extend(
  withLocalStorage({ key: SESSION_STORAGE_KEYS.refreshToken, subscribe: false }),
)

export const userAtom = atom<authApi.User | null>(null, 'session.user').extend(
  withLocalStorage({ key: SESSION_STORAGE_KEYS.user, subscribe: false }),
)

/** The non-null shape of the persisted session user. */
export type SessionUser = NonNullable<ReturnType<typeof userAtom>>

export const setSession = action(
  (s: { accessToken: string; refreshToken: string; user: authApi.User }) => {
    accessTokenAtom.set(s.accessToken)
    refreshTokenAtom.set(s.refreshToken)
    userAtom.set(s.user)
  },
  'session.set',
)

export const setSessionUser = action((user: authApi.User) => {
  userAtom.set(user)
}, 'session.setUser')

export const clearSession = action(() => {
  accessTokenAtom.set(null)
  refreshTokenAtom.set(null)
  userAtom.set(null)
}, 'session.clear')

// Becomes true after the first loadCurrentUserAction attempt completes (success or failure).
// AuthRouteGuard uses this to avoid redirecting before the initial /auth/me fetch settles.
export const sessionRestoredAtom = atom(false, 'session.restored')
