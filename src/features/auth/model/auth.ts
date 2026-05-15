import { action, withAsync, wrap } from '@reatom/core'
import { auth as authApi, UnauthorizedError } from '@/shared/api'
import { clearSession, setSession, setSessionUser, tokenAtom } from '@/entities/session'

export const loginAction = action(async (body: authApi.LoginRequest) => {
  const { token, user } = await wrap(authApi.login(body))
  setSession({ token, user })
}, 'auth.login').extend(
  withAsync({
    parseError: (e) => {
      if (e instanceof UnauthorizedError) return new Error('Invalid email or password')
      if (e instanceof Error) return e
      return new Error('Login failed')
    },
  }),
)

export const logoutAction = action(async () => {
  try {
    await wrap(authApi.logout())
  } catch {
    // Even if server logout fails, drop local credentials.
  }
  clearSession()
}, 'auth.logout')

export const loadCurrentUserAction = action(async () => {
  if (tokenAtom() === null) return
  try {
    const user = await wrap(authApi.getMe())
    setSessionUser(user)
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      clearSession()
    }
  }
}, 'auth.loadCurrentUser')
