import { action, atom, withLocalStorage } from '@reatom/core'
import { auth as authApi } from '@/shared/api'

export const tokenAtom = atom<string | null>(null, 'session.token').extend(
  withLocalStorage('session.token'),
)
export const userAtom = atom<authApi.User | null>(null, 'session.user')

export const setSession = action((s: { token: string; user: authApi.User }) => {
  tokenAtom.set(s.token)
  userAtom.set(s.user)
}, 'session.set')

export const setSessionUser = action((user: authApi.User) => {
  userAtom.set(user)
}, 'session.setUser')

export const clearSession = action(() => {
  tokenAtom.set(null)
  userAtom.set(null)
}, 'session.clear')
