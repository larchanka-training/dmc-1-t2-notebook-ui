import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createNotebookAction, notebookListAtom } from './notebookList'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  notebookListAtom.set([])
  createNotebookAction.error.set(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createNotebookAction', () => {
  test('appends to the list and returns the new notebook', async () => {
    const existing = { id: 'nb1', title: 'old', createdAt: '2026-05-01T00:00:00Z', cells: [] }
    notebookListAtom.set([existing])

    const created = { id: 'nb2', title: 'new', createdAt: '2026-05-15T00:00:00Z', cells: [] }
    fetchMock.mockResolvedValueOnce(jsonResponse(201, created))

    const result = await createNotebookAction('new')

    expect(result).toEqual(created)
    expect(notebookListAtom()).toEqual([existing, created])
  })

  test('refuses empty titles without calling the API', async () => {
    const result = await createNotebookAction('   ')
    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('surfaces error via createNotebookAction.error() on 401', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { code: 'unauthenticated', message: 'nope' }))

    await expect(createNotebookAction('new')).rejects.toThrow()
    expect(createNotebookAction.error()).toBeDefined()
  })
})
