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

describe('notebook.list', () => {
  test('GET /notebooks returns parsed list', async () => {
    const payload = [{ id: 'n1', title: 'first', createdAt: '2026-05-15T00:00:00Z', cells: [] }]
    fetchMock.mockResolvedValueOnce(jsonResponse(200, payload))

    const result = await notebook.list()

    expect(result).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledOnce()
    const req = lastRequest()
    expect(req.url).toContain('/notebooks')
    expect(req.method).toBe('GET')
  })

  test('401 maps to UnauthorizedError', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { code: 'unauthenticated', message: 'no session' }),
    )
    await expect(notebook.list()).rejects.toBeInstanceOf(UnauthorizedError)
  })

  test('sends Bearer header when token getter is set', async () => {
    setAuthTokenGetter(() => 'tok-123')
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []))

    await notebook.list()

    expect(lastRequest().headers.get('authorization')).toBe('Bearer tok-123')
  })
})

describe('notebook.create', () => {
  test('POSTs body and returns created notebook', async () => {
    const created = { id: 'n2', title: 'hi', createdAt: '2026-05-15T00:00:00Z', cells: [] }
    fetchMock.mockResolvedValueOnce(jsonResponse(201, created))

    const result = await notebook.create({ title: 'hi' })

    expect(result).toEqual(created)
    const req = lastRequest()
    expect(req.url).toContain('/notebooks')
    expect(req.method).toBe('POST')
    expect(await req.clone().json()).toEqual({ title: 'hi' })
  })
})

describe('notebook.runCell', () => {
  test('substitutes path params', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { status: 'done', output: 'ok', durationMs: 5 }),
    )

    const result = await notebook.runCell('nb-1', 'cell-1')

    if (result.status !== 'done') throw new Error('expected done')
    expect(result.output).toBe('ok')
    expect(result.durationMs).toBe(5)
    expect(lastRequest().url).toContain('/notebooks/nb-1/cells/cell-1/run')
  })

  test('404 maps to NotFoundError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { code: 'not_found', message: 'cell gone' }))
    await expect(notebook.runCell('nb-x', 'cell-x')).rejects.toBeInstanceOf(NotFoundError)
  })
})
