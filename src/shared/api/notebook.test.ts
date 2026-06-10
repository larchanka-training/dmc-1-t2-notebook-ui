import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as notebook from './notebook'
import { NotFoundError, UnauthorizedError } from './errors'
import { setAuthTokenGetter } from './client'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
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
      jsonResponse(401, { code: 'unauthenticated', message: 'no session' }),
    )
    await expect(notebook.list()).rejects.toBeInstanceOf(UnauthorizedError)
  })

  test('404 maps to NotFoundError', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(404, { code: 'not_found', message: 'notebook gone' }),
    )
    // runCell (and its endpoint) was dropped in TARDIS-131; error mapping is
    // status-driven, so any facade call exercises it. #132 adds get/patch/delete.
    await expect(notebook.list()).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('auth middleware', () => {
  test('sends Bearer header when token getter is set', async () => {
    setAuthTokenGetter(() => 'tok-123')
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []))

    await notebook.list()

    expect(lastRequest().headers.get('authorization')).toBe('Bearer tok-123')
  })

  test('omits Authorization header when token getter returns null', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []))

    await notebook.list()

    expect(lastRequest().headers.has('authorization')).toBe(false)
  })
})
