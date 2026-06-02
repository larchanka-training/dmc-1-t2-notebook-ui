import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as auth from './auth'
import { BadRequestError, UnauthorizedError } from './errors'
import { setAuthTokenGetter } from './client'

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

function lastRequest(): Request {
  return fetchMock.mock.calls.at(-1)![0] as Request
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  setAuthTokenGetter(() => null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('requestOtp', () => {
  test('204 (production) resolves to null', async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(204))
    await expect(auth.requestOtp('a@b.com')).resolves.toBeNull()
  })

  test('200 (dev) resolves to OtpRequestResponse with otp and expiresAt', async () => {
    const body = { otp: '123456', expiresAt: 1779367500000 }
    fetchMock.mockResolvedValueOnce(jsonResponse(200, body))
    await expect(auth.requestOtp('a@b.com')).resolves.toEqual(body)
  })

  test('400 throws BadRequestError', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { code: 'invalid_email', message: 'bad email' }),
    )
    await expect(auth.requestOtp('not-an-email')).rejects.toBeInstanceOf(BadRequestError)
  })

  test('429 throws ApiError with status 429', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(429, { code: 'too_many_otp_requests', message: 'slow down' }),
    )
    const err = await auth.requestOtp('a@b.com').catch((e) => e)
    expect(err.status).toBe(429)
  })
})

describe('verifyOtp', () => {
  test('200 resolves to AuthResponse with accessToken, refreshToken, user', async () => {
    const body = {
      accessToken: 'access-jwt',
      refreshToken: 'refresh-opaque',
      user: { id: 'u1', email: 'a@b.com', roles: [] },
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(200, body))
    await expect(auth.verifyOtp({ email: 'a@b.com', otp: '123456' })).resolves.toEqual(body)
  })

  test('401 invalid_otp throws UnauthorizedError', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { code: 'invalid_otp', message: 'wrong code' }),
    )
    await expect(auth.verifyOtp({ email: 'a@b.com', otp: '000000' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    )
  })

  test('401 otp_expired throws UnauthorizedError with matching code', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { code: 'otp_expired', message: 'expired' }))
    const err = await auth.verifyOtp({ email: 'a@b.com', otp: '123456' }).catch((e) => e)
    expect(err).toBeInstanceOf(UnauthorizedError)
    expect(err.code).toBe('otp_expired')
  })
})

describe('refreshTokens', () => {
  test('200 resolves to new accessToken and refreshToken', async () => {
    const body = { accessToken: 'new-access', refreshToken: 'new-refresh' }
    fetchMock.mockResolvedValueOnce(jsonResponse(200, body))
    await expect(auth.refreshTokens('old-refresh')).resolves.toEqual(body)
  })

  test('401 throws UnauthorizedError', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { code: 'refresh_expired', message: 'expired' }),
    )
    await expect(auth.refreshTokens('stale')).rejects.toBeInstanceOf(UnauthorizedError)
  })
})

describe('logout', () => {
  test('204 resolves to void', async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(204))
    await expect(auth.logout('refresh-tok')).resolves.toBeUndefined()
  })

  test('sends refreshToken in request body', async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(204))
    await auth.logout('my-refresh-token')
    const body = JSON.parse(await lastRequest().text())
    expect(body).toEqual({ refreshToken: 'my-refresh-token' })
  })
})

describe('auth middleware', () => {
  test('attaches Bearer header from token getter', async () => {
    setAuthTokenGetter(() => 'tok-abc')
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'u1', email: 'a@b.com', roles: [] }))
    await auth.getMe()
    expect(lastRequest().headers.get('authorization')).toBe('Bearer tok-abc')
  })

  test('omits Authorization header when token getter returns null', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'u1', email: 'a@b.com', roles: [] }))
    await auth.getMe()
    expect(lastRequest().headers.has('authorization')).toBe(false)
  })
})
