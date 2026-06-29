import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { userAtom } from '@/entities/session'
import { notebookStorage } from '../persistence/activeStorage'
import { FORMAT_VERSION } from '../persistence/schema'
import { readLastOpenedId, resolveOwnedLastOpenedId, writeLastOpenedId } from './lastOpened'
import { LOCAL_NOTEBOOK_ID } from './notebook'

const USER = { id: 'owner-A', roles: [] }
const NB_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NB_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

// Mirror notebook.test.ts: ownership lives only in the sync-state ownerId
// (NotebookJSON carries none), so a stored notebook is "owned" once its
// sync-state names the owner.
const putOwned = async (id: string, ownerId: string) => {
  await notebookStorage.put({
    formatVersion: FORMAT_VERSION,
    id,
    title: `nb-${id}`,
    createdAt: 1,
    updatedAt: 1,
    cells: [],
  })
  await notebookStorage.putSyncState({
    notebookId: id,
    remoteCreated: true,
    dirty: false,
    ownerId,
    deletedCells: [],
  })
}

describe('lastOpened persistence (TARDIS-183)', () => {
  beforeEach(async () => {
    localStorage.clear()
    await notebookStorage.clearAll()
    userAtom.set(USER as never)
  })
  afterEach(async () => {
    localStorage.clear()
    await notebookStorage.clearAll()
    userAtom.set(null)
  })

  test('write then read round-trips for the same user', () => {
    writeLastOpenedId(USER.id, NB_A)
    expect(readLastOpenedId(USER.id)).toBe(NB_A)
  })

  test('is isolated per user (no cross-account read)', () => {
    writeLastOpenedId('owner-A', NB_A)
    writeLastOpenedId('owner-B', NB_B)
    expect(readLastOpenedId('owner-A')).toBe(NB_A)
    expect(readLastOpenedId('owner-B')).toBe(NB_B)
  })

  test('is keyed case-insensitively', () => {
    writeLastOpenedId('Owner-A', NB_A)
    expect(readLastOpenedId('owner-a')).toBe(NB_A)
  })

  test('read returns null for an unknown user / no record', () => {
    expect(readLastOpenedId('nobody')).toBeNull()
  })

  test('read/write are no-ops when signed out (null userId)', () => {
    writeLastOpenedId(null, NB_A)
    expect(readLastOpenedId(null)).toBeNull()
  })

  test('write is a no-op for the local welcome floor id', () => {
    writeLastOpenedId(USER.id, LOCAL_NOTEBOOK_ID)
    expect(readLastOpenedId(USER.id)).toBeNull()
  })

  describe('resolveOwnedLastOpenedId', () => {
    test('returns the stored id when it is owned by the current user', async () => {
      await putOwned(NB_A, USER.id)
      writeLastOpenedId(USER.id, NB_A)
      expect(await resolveOwnedLastOpenedId()).toBe(NB_A)
    })

    test('returns null when the stored id is NOT owned (belongs to another account)', async () => {
      // The id was persisted as "last opened", but locally it is owned by a
      // different account — opening it would be a cross-account leak (§11).
      await putOwned(NB_A, 'someone-else')
      writeLastOpenedId(USER.id, NB_A)
      expect(await resolveOwnedLastOpenedId()).toBeNull()
    })

    test('returns null when there is no stored id', async () => {
      await putOwned(NB_A, USER.id)
      expect(await resolveOwnedLastOpenedId()).toBeNull()
    })

    test('returns null when the stored id has no local copy', async () => {
      // Persisted last-opened, but no local notebook with that id (e.g. server
      // only). The resolver does NOT confirm via the server list (no hidden GET).
      writeLastOpenedId(USER.id, NB_A)
      expect(await resolveOwnedLastOpenedId()).toBeNull()
    })

    test('returns null when signed out', async () => {
      await putOwned(NB_A, USER.id)
      writeLastOpenedId(USER.id, NB_A)
      userAtom.set(null)
      expect(await resolveOwnedLastOpenedId()).toBeNull()
    })
  })
})
