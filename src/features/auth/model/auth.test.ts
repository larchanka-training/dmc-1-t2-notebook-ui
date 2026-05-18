import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { loadCurrentUserAction, loginAction, logoutAction } from './auth'
import { clearSession, setSession, tokenAtom, userAtom } from '@/entities/session'
import * as authApi from '@/shared/api/auth'
import { UnauthorizedError } from '@/shared/api/errors'

beforeEach(() => {
  localStorage.clear()
  clearSession()
  loginAction.error.set(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('loginAction', () => {
  test('on success: sets session token and user', async () => {
    const payload = { token: 'jwt-1', user: { id: 'u1', email: 'a@b.com', displayName: 'a' } }
    vi.spyOn(authApi, 'login').mockResolvedValue(payload)

    await loginAction({ email: 'a@b.com', password: 'pw' })

    expect(tokenAtom()).toBe('jwt-1')
    expect(userAtom()).toEqual(payload.user)
    expect(loginAction.error()).toBeUndefined()
  })

  test('on 401: surfaces a friendly error via loginAction.error()', async () => {
    vi.spyOn(authApi, 'login').mockRejectedValue(
      new UnauthorizedError('invalid_credentials', 'nope'),
    )

    await expect(loginAction({ email: 'a@b.com', password: 'wrong' })).rejects.toThrow()
    expect(tokenAtom()).toBeNull()
    expect(userAtom()).toBeNull()
    expect(loginAction.error()?.message).toBe('Invalid email or password')
  })

  test('toggles loginAction.ready() during the call', async () => {
    let resolveLogin!: (v: authApi.LoginResponse) => void
    vi.spyOn(authApi, 'login').mockReturnValue(
      new Promise<authApi.LoginResponse>((resolve) => {
        resolveLogin = resolve
      }),
    )

    const promise = loginAction({ email: 'a@b.com', password: 'pw' })
    expect(loginAction.ready()).toBe(false)
    resolveLogin({ token: 't', user: { id: 'u', email: 'a@b.com' } })
    await promise
    expect(loginAction.ready()).toBe(true)
  })
})

describe('logoutAction', () => {
  test('clears session even when server logout fails', async () => {
    setSession({ token: 'jwt-1', user: { id: 'u1', email: 'a@b.com' } })
    vi.spyOn(authApi, 'logout').mockRejectedValue(new Error('boom'))

    await logoutAction()

    expect(tokenAtom()).toBeNull()
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
    setSession({ token: 'jwt-1', user: { id: 'old', email: 'old@b.com' } })
    vi.spyOn(authApi, 'getMe').mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      displayName: 'a',
    })

    await loadCurrentUserAction()

    expect(userAtom()).toEqual({ id: 'u1', email: 'a@b.com', displayName: 'a' })
  })

  test('drops session when server returns 401', async () => {
    setSession({ token: 'jwt-stale', user: { id: 'u', email: 'a@b.com' } })
    vi.spyOn(authApi, 'getMe').mockRejectedValue(
      new UnauthorizedError('unauthenticated', 'expired'),
    )

    await loadCurrentUserAction()

    expect(tokenAtom()).toBeNull()
    expect(userAtom()).toBeNull()
  })
})
