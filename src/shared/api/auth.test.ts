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

describe('error mapping', () => {
  test('401 maps to UnauthorizedError', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { code: 'invalid_credentials', message: 'nope' }),
    )
    await expect(auth.login({ email: 'a@b.com', password: 'wrong' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    )
  })

  test('204 resolves to void', async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(204))
    await expect(auth.logout()).resolves.toBeUndefined()
  })
})

describe('auth middleware', () => {
  test('attaches Bearer header from token getter', async () => {
    setAuthTokenGetter(() => 'tok-abc')
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'u1', email: 'a@b.com' }))
    await auth.getMe()
    expect(lastRequest().headers.get('authorization')).toBe('Bearer tok-abc')
  })

  test('omits Authorization header when token getter returns null', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'u1', email: 'a@b.com' }))
    await auth.getMe()
    expect(lastRequest().headers.has('authorization')).toBe(false)
  })
})
