import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as auth from './auth'
import { UnauthorizedError } from './errors'
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

describe('auth.login', () => {
  test('POSTs credentials, returns token + user', async () => {
    const payload = { token: 'jwt-xyz', user: { id: 'u1', email: 'a@b.com' } }
    fetchMock.mockResolvedValueOnce(jsonResponse(200, payload))

    const result = await auth.login({ email: 'a@b.com', password: 'secret' })

    expect(result).toEqual(payload)
    const req = lastRequest()
    expect(req.url).toContain('/auth/login')
    expect(req.method).toBe('POST')
    expect(await req.clone().json()).toEqual({ email: 'a@b.com', password: 'secret' })
  })

  test('401 maps to UnauthorizedError', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { code: 'invalid_credentials', message: 'nope' }),
    )
    await expect(auth.login({ email: 'a@b.com', password: 'wrong' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    )
  })
})

describe('auth.logout', () => {
  test('returns void on 204', async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(204))
    await expect(auth.logout()).resolves.toBeUndefined()
  })
})

describe('auth.getMe', () => {
  test('GETs /auth/me and returns user', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'u1', email: 'a@b.com' }))
    const user = await auth.getMe()
    expect(user).toEqual({ id: 'u1', email: 'a@b.com' })
    const req = lastRequest()
    expect(req.url).toContain('/auth/me')
    expect(req.method).toBe('GET')
  })

  test('attaches Bearer header from token getter', async () => {
    setAuthTokenGetter(() => 'tok-abc')
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'u1', email: 'a@b.com' }))
    await auth.getMe()
    expect(lastRequest().headers.get('authorization')).toBe('Bearer tok-abc')
  })
})
