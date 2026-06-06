import { action, urlAtom, withAsync, wrap } from '@reatom/core'
import { auth as authApi, UnauthorizedError } from '@/shared/api'
import {
  accessTokenAtom,
  clearSession,
  refreshTokenAtom,
  sessionRestoredAtom,
  setSession,
  setSessionUser,
} from '@/entities/session'
import { appPath } from '@/shared/lib/paths'

// #7 — named constant so both parseError and LoginForm reference the same value;
// a rename is a compile error, not a silent UI regression.
export const OTP_EXPIRED_CODE = 'otp_expired' as const

export const requestOtpAction = action(async (email: string) => {
  return await wrap(authApi.requestOtp(email))
}, 'auth.requestOtp').extend(
  withAsync({
    parseError: (e) => {
      if (e instanceof Error) return e
      return new Error('Failed to send code')
    },
  }),
)

export const verifyOtpAction = action(async (body: { email: string; otp: string }) => {
  const { accessToken, refreshToken, user } = await wrap(authApi.verifyOtp(body))
  setSession({ accessToken, refreshToken, user })
  // #1 — reject protocol-relative URLs (//evil.com) which pass startsWith('/')
  // but resolve to an external origin when passed to new URL() or location.replace.
  const rawFrom = urlAtom().searchParams.get('from')
  // Default to the app base (import.meta.env.BASE_URL — '/pr-<N>/' under a
  // preview), not '/', so a login without ?from stays inside the app.
  const from = rawFrom?.startsWith('/') && !rawFrom.startsWith('//') ? rawFrom : appPath()
  urlAtom.set((url) => new URL(from, url.origin), true)
}, 'auth.verifyOtp').extend(
  withAsync({
    parseError: (e) => {
      if (e instanceof UnauthorizedError) {
        if (e.code === OTP_EXPIRED_CODE) return new Error(OTP_EXPIRED_CODE)
        return new Error('Invalid code. Check and try again.')
      }
      if (e instanceof Error) return e
      return new Error('Verification failed')
    },
  }),
)

export const logoutAction = action(async () => {
  // #10 — skip the server call when there is no refresh token rather than
  // sending an empty string body; the token is cleared locally either way.
  const token = refreshTokenAtom()
  if (token) {
    try {
      await wrap(authApi.logout(token))
    } catch {
      // Even if server logout fails, drop local credentials.
    }
  }
  clearSession()
}, 'auth.logout')

export const loadCurrentUserAction = action(async () => {
  if (accessTokenAtom() !== null) {
    try {
      const user = await wrap(authApi.getMe())
      setSessionUser(user)
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        clearSession()
      }
    }
  }
  sessionRestoredAtom.set(true)
}, 'auth.loadCurrentUser')
