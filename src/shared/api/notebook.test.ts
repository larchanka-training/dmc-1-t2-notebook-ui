import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as notebook from './notebook'
import {
  ApiError,
  ConflictError,
  NetworkError,
  NotFoundError,
  RateLimitedError,
  UnauthorizedError,
} from './errors'
import { setAuthTokenGetter } from './client'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function noContentResponse(): Response {
  return new Response(null, { status: 204 })
}

let fetchMock: ReturnType<typeof vi.fn>

function lastRequest(): Request {
  return fetchMock.mock.calls.at(-1)![0] as Request
}

async function lastRequestBody(): Promise<Record<string, unknown>> {
  return JSON.parse(await lastRequest().clone().text())
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
      jsonResponse(401, { error: { code: 'invalid_token', message: 'expired' } }),
    )
    await expect(notebook.list()).rejects.toBeInstanceOf(UnauthorizedError)
  })

  test('409 maps to ConflictError', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { error: { code: 'notebook_conflict', message: 'id taken' } }),
    )
    await expect(notebook.create({ title: 'n', formatVersion: 1 })).rejects.toBeInstanceOf(
      ConflictError,
    )
  })

  test('a rejected fetch (no response) maps to NetworkError', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(notebook.list()).rejects.toBeInstanceOf(NetworkError)
  })
})

describe('auth middleware', () => {
  test('sends Bearer header when token getter is set', async () => {
    setAuthTokenGetter(() => 'tok-123')
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { items: [], total: 0, limit: 200, offset: 0 }),
    )

    await notebook.list()

    expect(lastRequest().headers.get('authorization')).toBe('Bearer tok-123')
  })

  test('omits Authorization header when token getter returns null', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { items: [], total: 0, limit: 200, offset: 0 }),
    )

    await notebook.list()

    expect(lastRequest().headers.has('authorization')).toBe(false)
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

  test('rejects with a malformed_response ApiError when the body has no items array', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { total: 0 }))

    const err = await notebook.list().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).code).toBe('malformed_response')
  })
})

describe('get', () => {
  const full = {
    id: 'nb-1',
    ownerId: 'owner-1',
    title: 'My notebook',
    formatVersion: 1,
    createdAt: 0,
    updatedAt: 0,
    cells: [{ id: 'c1', kind: 'code', content: 'x', updatedAt: 5 }],
  }

  test('GETs /notebooks/{id} and returns the full notebook with cells', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, full))

    const result = await notebook.get('nb-1')

    expect(result).toEqual(full)
    const req = lastRequest()
    expect(req.method).toBe('GET')
    expect(req.url).toContain('/api/v1/notebooks/nb-1')
  })

  test('normalizes a cells-less response to an empty array', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        id: 'nb-1',
        ownerId: 'owner-1',
        title: 'My notebook',
        formatVersion: 1,
        createdAt: 0,
        updatedAt: 0,
      }),
    )

    const result = await notebook.get('nb-1')

    expect(result.cells).toEqual([])
  })

  test('rejects with malformed_response when cells is present but not an array', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        id: 'nb-1',
        ownerId: 'owner-1',
        title: 'My notebook',
        formatVersion: 1,
        createdAt: 0,
        updatedAt: 0,
        cells: null,
      }),
    )

    const err = await notebook.get('nb-1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).code).toBe('malformed_response')
  })

  test('404 maps to NotFoundError', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(404, { error: { code: 'not_found', message: 'gone' } }),
    )
    await expect(notebook.get('missing')).rejects.toBeInstanceOf(NotFoundError)
  })

  test('401 maps to UnauthorizedError', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { code: 'invalid_token', message: 'expired' } }),
    )
    await expect(notebook.get('nb-1')).rejects.toBeInstanceOf(UnauthorizedError)
  })

  test('429 maps to RateLimitedError carrying the parsed Retry-After', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'slow down' } }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'Retry-After': '30' },
      }),
    )
    const err = await notebook.get('nb-1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RateLimitedError)
    expect((err as RateLimitedError).retryAfter).toBe(30)
  })

  test('a rejected fetch maps to NetworkError', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(notebook.get('nb-1')).rejects.toBeInstanceOf(NetworkError)
  })
})

describe('create', () => {
  const created = {
    id: 'nb-1',
    ownerId: 'owner-1',
    title: 'My notebook',
    formatVersion: 1,
    createdAt: 0,
    updatedAt: 0,
    cells: [],
  }

  test('POSTs title and the caller-supplied formatVersion, returns the notebook', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, created))

    const result = await notebook.create({ title: 'My notebook', formatVersion: 1 })

    expect(result).toEqual(created)
    const req = lastRequest()
    expect(req.method).toBe('POST')
    expect(await lastRequestBody()).toEqual({ title: 'My notebook', formatVersion: 1 })
  })

  test('forwards a client-chosen id and cells for offline-first creation', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, created))

    const cells = [{ id: 'c1', kind: 'code' as const, content: 'x', updatedAt: 5 }]
    await notebook.create({ title: 'My notebook', formatVersion: 1, id: 'nb-1', cells })

    expect(await lastRequestBody()).toEqual({
      title: 'My notebook',
      formatVersion: 1,
      id: 'nb-1',
      cells,
    })
  })

  test('omits id and cells from the body when not provided', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, created))

    await notebook.create({ title: 'My notebook', formatVersion: 1 })

    const body = await lastRequestBody()
    expect(body).not.toHaveProperty('id')
    expect(body).not.toHaveProperty('cells')
  })

  test('normalizes a cells-less response to an empty array', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        id: 'nb-1',
        ownerId: 'owner-1',
        title: 'My notebook',
        formatVersion: 1,
        createdAt: 0,
        updatedAt: 0,
      }),
    )

    const result = await notebook.create({ title: 'My notebook', formatVersion: 1 })

    expect(result.cells).toEqual([])
  })

  test('422 maps to a generic ApiError carrying the status', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, { detail: [{ loc: ['body', 'title'], msg: 'required', type: 'missing' }] }),
    )
    await expect(notebook.create({ title: '', formatVersion: 1 })).rejects.toMatchObject({
      status: 422,
    })
  })

  test('a rejected fetch maps to NetworkError', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(notebook.create({ title: 'n', formatVersion: 1 })).rejects.toBeInstanceOf(
      NetworkError,
    )
  })
})

describe('patch', () => {
  const updated = {
    id: 'nb-1',
    ownerId: 'owner-1',
    title: 'Renamed',
    formatVersion: 1,
    createdAt: 0,
    updatedAt: 10,
    cells: [{ id: 'c1', kind: 'code', content: 'y', updatedAt: 10 }],
  }
  const cells = [{ id: 'c1', kind: 'code' as const, content: 'y', updatedAt: 10 }]

  test('PATCHes the whole notebook (title, formatVersion, cells)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, updated))

    const result = await notebook.patch('nb-1', { title: 'Renamed', formatVersion: 1, cells })

    expect(result).toEqual(updated)
    const req = lastRequest()
    expect(req.method).toBe('PATCH')
    expect(req.url).toContain('/api/v1/notebooks/nb-1')
    expect(await lastRequestBody()).toEqual({ title: 'Renamed', formatVersion: 1, cells })
  })

  test('sends deletedCells in the body when provided', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, updated))

    const deletedCells = [{ id: 'c2', deletedAt: 9 }]
    await notebook.patch('nb-1', { title: 'Renamed', formatVersion: 1, cells, deletedCells })

    expect(await lastRequestBody()).toEqual({
      title: 'Renamed',
      formatVersion: 1,
      cells,
      deletedCells,
    })
  })

  test('omits deletedCells from the body when not provided', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, updated))

    await notebook.patch('nb-1', { title: 'Renamed', formatVersion: 1, cells })

    expect(await lastRequestBody()).not.toHaveProperty('deletedCells')
  })

  test('422 maps to a generic ApiError carrying the status', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, { detail: [{ loc: ['body', 'title'], msg: 'required', type: 'missing' }] }),
    )
    await expect(
      notebook.patch('nb-1', { title: '', formatVersion: 1, cells }),
    ).rejects.toMatchObject({ status: 422 })
  })

  test('401 maps to UnauthorizedError', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { code: 'invalid_token', message: 'expired' } }),
    )
    await expect(
      notebook.patch('nb-1', { title: 'Renamed', formatVersion: 1, cells }),
    ).rejects.toBeInstanceOf(UnauthorizedError)
  })

  test('a rejected fetch maps to NetworkError', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(
      notebook.patch('nb-1', { title: 'Renamed', formatVersion: 1, cells }),
    ).rejects.toBeInstanceOf(NetworkError)
  })
})

describe('remove', () => {
  test('DELETEs /notebooks/{id} and resolves on 204', async () => {
    fetchMock.mockResolvedValueOnce(noContentResponse())

    await expect(notebook.remove('nb-1')).resolves.toBeUndefined()
    const req = lastRequest()
    expect(req.method).toBe('DELETE')
    expect(req.url).toContain('/api/v1/notebooks/nb-1')
  })

  test('401 maps to UnauthorizedError', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { code: 'invalid_token', message: 'expired' } }),
    )
    await expect(notebook.remove('nb-1')).rejects.toBeInstanceOf(UnauthorizedError)
  })

  test('404 maps to NotFoundError', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(404, { error: { code: 'not_found', message: 'gone' } }),
    )
    await expect(notebook.remove('missing')).rejects.toBeInstanceOf(NotFoundError)
  })

  test('a rejected fetch maps to NetworkError', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(notebook.remove('nb-1')).rejects.toBeInstanceOf(NetworkError)
  })
})
