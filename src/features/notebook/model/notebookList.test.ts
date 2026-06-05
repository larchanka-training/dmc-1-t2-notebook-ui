import { peek } from '@reatom/core'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { notebook as notebookApi } from '@/shared/api'
import { ApiError } from '@/shared/api/errors'
import { createNotebookAction, notebookListResource } from './notebookList'

// GET /notebooks returns lightweight rows (NotebookListItem); POST returns the
// full Notebook. Helpers keep the two shapes straight in the assertions below.
const listItem = (id: string, title: string): notebookApi.NotebookListItem => ({
  id,
  title,
  formatVersion: 1,
  createdAt: 0,
  updatedAt: 0,
  cellsCount: 0,
})

const fullNotebook = (id: string, title: string): notebookApi.Notebook => ({
  id,
  title,
  createdAt: '2026-05-15T00:00:00Z',
  cells: [],
})

beforeEach(() => {
  vi.spyOn(notebookApi, 'list').mockResolvedValue([])
  notebookListResource.reset()
  createNotebookAction.error.set(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createNotebookAction', () => {
  test('creates the notebook and invalidates the resource', async () => {
    const existing = listItem('nb1', 'old')
    notebookListResource.data.set([existing])

    const created = fullNotebook('nb2', 'new')
    const createdItem = listItem('nb2', 'new')
    const createSpy = vi.spyOn(notebookApi, 'create').mockResolvedValue(created)
    vi.spyOn(notebookApi, 'list').mockResolvedValue([existing, createdItem])

    const result = await createNotebookAction('new')

    expect(result).toEqual(created)
    expect(createSpy).toHaveBeenCalledWith({ title: 'new' })
    expect(peek(notebookListResource.data)).toEqual([existing, createdItem])
  })

  test('refuses empty titles without calling the API', async () => {
    const createSpy = vi.spyOn(notebookApi, 'create')
    const result = await createNotebookAction('   ')
    expect(result).toBeNull()
    expect(createSpy).not.toHaveBeenCalled()
  })

  test('surfaces error via createNotebookAction.error() on 401', async () => {
    vi.spyOn(notebookApi, 'create').mockRejectedValue(new ApiError(401, 'unauthenticated', 'nope'))

    await expect(createNotebookAction('new')).rejects.toThrow()
    expect(createNotebookAction.error()).toBeDefined()
  })

  test('rolls back the optimistic update when the API rejects', async () => {
    const existing = listItem('nb1', 'old')
    notebookListResource.data.set([existing])
    vi.spyOn(notebookApi, 'create').mockRejectedValue(new ApiError(500, 'boom', 'boom'))

    await expect(createNotebookAction('new')).rejects.toThrow()
    expect(peek(notebookListResource.data)).toEqual([existing])
  })
})
