import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  OTP_EXPIRED_CODE,
  requestOtpAction,
  verifyOtpAction,
  logoutAction,
  loadCurrentUserAction,
} from './auth'
import {
  accessTokenAtom,
  clearSession,
  refreshTokenAtom,
  setSession,
  userAtom,
} from '@/entities/session'
import * as authApi from '@/shared/api/auth'
import { UnauthorizedError } from '@/shared/api/errors'

const stubUser = { id: 'u1', email: 'a@b.com', roles: [] as string[] }
const stubSession = { accessToken: 'access-jwt', refreshToken: 'refresh-tok', user: stubUser }

beforeEach(() => {
  localStorage.clear()
  clearSession()
  requestOtpAction.error.set(undefined)
  verifyOtpAction.error.set(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('requestOtpAction', () => {
  test('production (204): returns null', async () => {
    vi.spyOn(authApi, 'requestOtp').mockResolvedValue(null)
    const data = await requestOtpAction('a@b.com')
    expect(data).toBeNull()
    expect(requestOtpAction.error()).toBeUndefined()
  })

  test('dev mode (200): returns OtpRequestResponse', async () => {
    const devData = { otp: '123456', expiresAt: 9_999_999 }
    vi.spyOn(authApi, 'requestOtp').mockResolvedValue(devData)
    const data = await requestOtpAction('a@b.com')
    expect(data).toEqual(devData)
  })

  test('on error: sets error with message', async () => {
    vi.spyOn(authApi, 'requestOtp').mockRejectedValue(new Error('network error'))
    await expect(requestOtpAction('bad')).rejects.toThrow()
    expect(requestOtpAction.error()?.message).toBe('network error')
  })
})

describe('verifyOtpAction', () => {
  test('on success: sets session tokens and user', async () => {
    vi.spyOn(authApi, 'verifyOtp').mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      user: stubUser,
    })

    await verifyOtpAction({ email: 'a@b.com', otp: '123456' })

    expect(accessTokenAtom()).toBe('new-access')
    expect(refreshTokenAtom()).toBe('new-refresh')
    expect(userAtom()).toEqual(stubUser)
    expect(verifyOtpAction.error()).toBeUndefined()
  })

  test('on 401 invalid_otp: error has user-friendly message', async () => {
    vi.spyOn(authApi, 'verifyOtp').mockRejectedValue(
      new UnauthorizedError('invalid_otp', 'wrong code'),
    )

    await expect(verifyOtpAction({ email: 'a@b.com', otp: '000000' })).rejects.toThrow()
    expect(verifyOtpAction.error()?.message).toBe('Invalid code. Check and try again.')
  })

  test('on 401 otp_expired: error message equals OTP_EXPIRED_CODE constant', async () => {
    vi.spyOn(authApi, 'verifyOtp').mockRejectedValue(
      new UnauthorizedError('otp_expired', 'expired'),
    )

    await expect(verifyOtpAction({ email: 'a@b.com', otp: '123456' })).rejects.toThrow()
    expect(verifyOtpAction.error()?.message).toBe(OTP_EXPIRED_CODE)
  })
})

describe('logoutAction', () => {
  test('clears session even when server logout fails', async () => {
    setSession(stubSession)
    vi.spyOn(authApi, 'logout').mockRejectedValue(new Error('boom'))

    await logoutAction()

    expect(accessTokenAtom()).toBeNull()
    expect(userAtom()).toBeNull()
  })

  test('passes refreshToken to server logout', async () => {
    setSession(stubSession)
    const spy = vi.spyOn(authApi, 'logout').mockResolvedValue()

    await logoutAction()

    expect(spy).toHaveBeenCalledWith(stubSession.refreshToken)
  })

  test('skips server call and clears session when no refresh token', async () => {
    // Session has no refresh token (e.g. partial/evicted storage)
    clearSession()
    const spy = vi.spyOn(authApi, 'logout')

    await logoutAction()

    expect(spy).not.toHaveBeenCalled()
    expect(accessTokenAtom()).toBeNull()
    expect(userAtom()).toBeNull()
  })
})

describe('loadCurrentUserAction', () => {
  test('is a no-op when no token is set', async () => {
    const spy = vi.spyOn(authApi, 'getMe')
    await loadCurrentUserAction()
    expect(spy).not.toHaveBeenCalled()
  })

  test('loads user when token is present', async () => {
    setSession(stubSession)
    vi.spyOn(authApi, 'getMe').mockResolvedValue({ ...stubUser, displayName: 'Alice' })

    await loadCurrentUserAction()

    expect(userAtom()).toEqual({ ...stubUser, displayName: 'Alice' })
  })

  test('drops session when server returns 401', async () => {
    setSession(stubSession)
    vi.spyOn(authApi, 'getMe').mockRejectedValue(
      new UnauthorizedError('unauthenticated', 'expired'),
    )

    await loadCurrentUserAction()

    expect(accessTokenAtom()).toBeNull()
    expect(userAtom()).toBeNull()
  })
})
