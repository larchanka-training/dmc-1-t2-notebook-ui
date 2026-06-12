import { peek } from '@reatom/core'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ApiError, notebook as notebookApi } from '@/shared/api'
import * as idLib from '@/shared/lib/id'
import { FORMAT_VERSION } from '../persistence/schema'
import { createNotebookAction, notebookListResource } from './notebookList'

// A fixed client UUID so the create payload (FU1) is deterministic to assert.
const CLIENT_ID = '11111111-1111-4111-8111-111111111111'

// GET /notebooks returns lightweight rows (NotebookListItem); POST returns the
// full Notebook. Helpers keep the two shapes straight in the assertions below.
const listItem = (id: string, title: string): notebookApi.NotebookListItem => ({
  id,
  title,
  formatVersion: FORMAT_VERSION,
  createdAt: 0,
  updatedAt: 0,
  cellsCount: 0,
})

const fullNotebook = (id: string, title: string): notebookApi.Notebook => ({
  id,
  title,
  ownerId: 'owner-1',
  formatVersion: FORMAT_VERSION,
  createdAt: 0,
  updatedAt: 0,
  cells: [],
})

beforeEach(() => {
  vi.spyOn(idLib, 'newId').mockReturnValue(CLIENT_ID)
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
    expect(createSpy).toHaveBeenCalledWith({
      id: CLIENT_ID,
      title: 'new',
      formatVersion: FORMAT_VERSION,
    })
    expect(peek(notebookListResource.data)).toEqual([existing, createdItem])
  })

  test('keeps the reconciled row when the post-create refetch fails (FU2)', async () => {
    const existing = listItem('nb1', 'old')
    notebookListResource.data.set([existing])

    // Server echoes the client id; the list refetch then fails transiently.
    const created = fullNotebook(CLIENT_ID, 'new')
    vi.spyOn(notebookApi, 'create').mockResolvedValue(created)
    vi.spyOn(notebookApi, 'list').mockRejectedValue(new ApiError(503, 'unavailable', 'down'))

    const result = await createNotebookAction('new')

    // The create succeeded, so the action resolves and the optimistic row is
    // reconciled to the server notebook — NOT rolled back by the failed refetch.
    expect(result).toEqual(created)
    expect(peek(notebookListResource.data)).toEqual([existing, listItem(CLIENT_ID, 'new')])
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
