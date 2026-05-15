import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { loadCurrentUserAction, loginAction, logoutAction } from './auth'
import { clearSession, setSession, tokenAtom, userAtom } from '@/entities/session'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function emptyResponse(status: number): Response {
  return new Response(null, { status })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  localStorage.clear()
  clearSession()
  loginAction.error.set(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loginAction', () => {
  test('on success: sets session token and user', async () => {
    const payload = { token: 'jwt-1', user: { id: 'u1', email: 'a@b.com', displayName: 'a' } }
    fetchMock.mockResolvedValueOnce(jsonResponse(200, payload))

    await loginAction({ email: 'a@b.com', password: 'pw' })

    expect(tokenAtom()).toBe('jwt-1')
    expect(userAtom()).toEqual(payload.user)
    expect(loginAction.error()).toBeUndefined()
  })

  test('on 401: surfaces a friendly error via loginAction.error()', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { code: 'invalid_credentials', message: 'nope' }),
    )

    await expect(loginAction({ email: 'a@b.com', password: 'wrong' })).rejects.toThrow()
    expect(tokenAtom()).toBeNull()
    expect(userAtom()).toBeNull()
    expect(loginAction.error()?.message).toBe('Invalid email or password')
  })

  test('toggles loginAction.ready() during the call', async () => {
    let resolveFetch!: (r: Response) => void
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolveFetch = r)))

    const promise = loginAction({ email: 'a@b.com', password: 'pw' })
    expect(loginAction.ready()).toBe(false)
    resolveFetch(jsonResponse(200, { token: 't', user: { id: 'u', email: 'a@b.com' } }))
    await promise
    expect(loginAction.ready()).toBe(true)
  })
})

describe('logoutAction', () => {
  test('clears session even when server logout fails', async () => {
    setSession({ token: 'jwt-1', user: { id: 'u1', email: 'a@b.com' } })

    fetchMock.mockResolvedValueOnce(emptyResponse(500))

    await logoutAction()

    expect(tokenAtom()).toBeNull()
    expect(userAtom()).toBeNull()
  })
})

describe('loadCurrentUserAction', () => {
  test('is a no-op when no token is set', async () => {
    await loadCurrentUserAction()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('loads user when token is present', async () => {
    setSession({ token: 'jwt-1', user: { id: 'old', email: 'old@b.com' } })
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { id: 'u1', email: 'a@b.com', displayName: 'a' }),
    )

    await loadCurrentUserAction()

    expect(userAtom()).toEqual({ id: 'u1', email: 'a@b.com', displayName: 'a' })
  })

  test('drops session when server returns 401', async () => {
    setSession({ token: 'jwt-stale', user: { id: 'u', email: 'a@b.com' } })
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { code: 'unauthenticated', message: 'expired' }),
    )

    await loadCurrentUserAction()

    expect(tokenAtom()).toBeNull()
    expect(userAtom()).toBeNull()
  })
})
