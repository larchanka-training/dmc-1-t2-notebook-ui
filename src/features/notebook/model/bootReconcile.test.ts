import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { notebook as notebookApi } from '@/shared/api'
import { userAtom } from '@/entities/session'
import { notebookStorage } from '../persistence/activeStorage'
import type { NotebookJSON } from '../persistence/schema'
import { reconcileBootFromServer } from './bootReconcile'
import { resolveDemoNotebookId } from './notebook'
import { isSeedTombstoned } from './seedTombstone'

const USER = { id: 'reconcile-owner', roles: [] }

function listItem(id: string, createdAt: number): notebookApi.NotebookListItem {
  return { id, title: `nb-${id}`, formatVersion: 1, createdAt, updatedAt: createdAt, cellsCount: 0 }
}

function serverDoc(id: string): notebookApi.Notebook {
  return {
    id,
    title: `nb-${id}`,
    formatVersion: 1,
    createdAt: 1,
    updatedAt: 2,
    cells: [],
    ownerId: USER.id,
  } as unknown as notebookApi.Notebook
}

function localDoc(id: string): NotebookJSON {
  return { formatVersion: 1, id, title: id, createdAt: 1, updatedAt: 1, cells: [] }
}

describe('reconcileBootFromServer (TARDIS-167 №23, step 4b)', () => {
  beforeEach(async () => {
    await notebookStorage.clearAll()
    userAtom.set(USER as never)
  })
  afterEach(async () => {
    await notebookStorage.clearAll()
    userAtom.set(null)
    vi.restoreAllMocks()
  })

  test('skips entirely when local storage already has notebooks', async () => {
    await notebookStorage.put(localDoc('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))
    const listSpy = vi.spyOn(notebookApi, 'list')

    expect(await reconcileBootFromServer()).toBe('skipped-local-present')
    expect(listSpy).not.toHaveBeenCalled()
  })

  test('returns "unavailable" when the server list cannot be fetched', async () => {
    vi.spyOn(notebookApi, 'list').mockRejectedValue(new Error('offline'))
    expect(await reconcileBootFromServer()).toBe('unavailable')
  })

  test('returns "empty" for a brand-new account (no server notebooks)', async () => {
    vi.spyOn(notebookApi, 'list').mockResolvedValue([])
    expect(await reconcileBootFromServer()).toBe('empty')
    expect(await isSeedTombstoned()).toBe(false)
  })

  test('existing user with seed present: pulls newest, no tombstone', async () => {
    const demoId = await resolveDemoNotebookId()
    const newest = '99999999-9999-4999-8999-999999999999'
    vi.spyOn(notebookApi, 'list').mockResolvedValue([listItem(newest, 300), listItem(demoId, 100)])
    const getSpy = vi.spyOn(notebookApi, 'get').mockResolvedValue(serverDoc(newest))

    expect(await reconcileBootFromServer()).toBe('reconciled')
    // Newest (list[0]) was fetched and written into local storage, stamped with
    // the current owner so the boot slot picker will open it (not fall to seed).
    expect(getSpy).toHaveBeenCalledWith(newest)
    expect(await notebookStorage.get(newest)).toBeDefined()
    const state = await notebookStorage.getSyncState(newest)
    expect(state?.ownerId).toBe(USER.id)
    expect(state?.remoteCreated).toBe(true)
    expect(await isSeedTombstoned()).toBe(false)
  })

  test('existing user with seed absent: tombstones the seed and pulls newest', async () => {
    const newest = '99999999-9999-4999-8999-999999999999'
    // The per-user demo id is NOT in the list → the seed was deleted elsewhere.
    vi.spyOn(notebookApi, 'list').mockResolvedValue([listItem(newest, 300)])
    vi.spyOn(notebookApi, 'get').mockResolvedValue(serverDoc(newest))

    expect(await reconcileBootFromServer()).toBe('reconciled-seed-deleted')
    expect(await isSeedTombstoned()).toBe(true)
    expect(await notebookStorage.get(newest)).toBeDefined()
  })
})
