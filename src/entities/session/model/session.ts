import { action, atom, withLocalStorage } from '@reatom/core'
import type { auth as authApi } from '@/shared/api'

// subscribe: false switches withLocalStorage from reactive-subscription mode to
// withInit mode — atoms are initialised from localStorage on first read inside
// any Reatom frame (including action bodies at startup), rather than waiting for
// a component subscription. Cross-tab atom sync is handled manually in setup.ts.
export const accessTokenAtom = atom<string | null>(null, 'session.accessToken').extend(
  withLocalStorage({ key: 'session.accessToken', subscribe: false }),
)

export const refreshTokenAtom = atom<string | null>(null, 'session.refreshToken').extend(
  withLocalStorage({ key: 'session.refreshToken', subscribe: false }),
)

export const userAtom = atom<authApi.User | null>(null, 'session.user').extend(
  withLocalStorage({ key: 'session.user', subscribe: false }),
)

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
