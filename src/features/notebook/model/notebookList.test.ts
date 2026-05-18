import { peek } from '@reatom/core'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { notebook as notebookApi } from '@/shared/api'
import { ApiError } from '@/shared/api/errors'
import { createNotebookAction, notebookListResource } from './notebookList'

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
    const existing = { id: 'nb1', title: 'old', createdAt: '2026-05-01T00:00:00Z', cells: [] }
    notebookListResource.data.set([existing])

    const created = { id: 'nb2', title: 'new', createdAt: '2026-05-15T00:00:00Z', cells: [] }
    const createSpy = vi.spyOn(notebookApi, 'create').mockResolvedValue(created)
    vi.spyOn(notebookApi, 'list').mockResolvedValue([existing, created])

    const result = await createNotebookAction('new')

    expect(result).toEqual(created)
    expect(createSpy).toHaveBeenCalledWith({ title: 'new' })
    expect(peek(notebookListResource.data)).toEqual([existing, created])
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
    const existing = { id: 'nb1', title: 'old', createdAt: '2026-05-01T00:00:00Z', cells: [] }
    notebookListResource.data.set([existing])
    vi.spyOn(notebookApi, 'create').mockRejectedValue(new ApiError(500, 'boom', 'boom'))

    await expect(createNotebookAction('new')).rejects.toThrow()
    expect(peek(notebookListResource.data)).toEqual([existing])
  })
})
