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
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { items: [] }))

    await notebook.list()

    expect(lastRequest().headers.get('authorization')).toBe('Bearer tok-123')
  })

  test('omits Authorization header when token getter returns null', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { items: [] }))

    await notebook.list()

    expect(lastRequest().headers.has('authorization')).toBe(false)
  })
})

describe('create', () => {
  test('POSTs the title with the default formatVersion and returns the notebook', async () => {
    const created = {
      id: 'nb-1',
      ownerId: 'owner-1',
      title: 'My notebook',
      formatVersion: 1,
      createdAt: 0,
      updatedAt: 0,
      cells: [],
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(201, created))

    const result = await notebook.create({ title: 'My notebook' })

    // The shim injects the server-defaulted formatVersion (TARDIS-131; #132
    // carries the real value) and returns the parsed notebook unchanged.
    expect(result).toEqual(created)
    const req = lastRequest()
    expect(req.method).toBe('POST')
    expect(JSON.parse(await req.clone().text())).toEqual({
      title: 'My notebook',
      formatVersion: 1,
    })
  })
})

describe('list', () => {
  test('GETs /notebooks?limit=200 and returns the page items', async () => {
    const items = [
      { id: 'a', title: 'A', formatVersion: 1, createdAt: 0, updatedAt: 0, cellsCount: 0 },
      { id: 'b', title: 'B', formatVersion: 1, createdAt: 0, updatedAt: 0, cellsCount: 0 },
    ]
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { items, total: 2, limit: 200, offset: 0 }))

    const result = await notebook.list()

    expect(result).toEqual(items)
    const req = lastRequest()
    expect(req.method).toBe('GET')
    expect(req.url).toContain('/api/v1/notebooks?limit=200')
  })
})
