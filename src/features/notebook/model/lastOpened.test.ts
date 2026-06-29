import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { userAtom } from '@/entities/session'
import { notebookStorage } from '../persistence/activeStorage'
import { FORMAT_VERSION } from '../persistence/schema'
import { readLastOpenedId, resolveOwnedLastOpenedId, writeLastOpenedId } from './lastOpened'
import { LOCAL_NOTEBOOK_ID } from './notebook'

const USER = { id: 'owner-A', roles: [] }
const NB_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NB_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

// A local notebook copy WITHOUT any sync-state — the state a server notebook is
// in right after `pullServerNotebook` (document only, no ownership stamp). This
// is the case the old resolver wrongly rejected (TARDIS-183 blocker).
const putLocalCopy = async (id: string) => {
  await notebookStorage.put({
    formatVersion: FORMAT_VERSION,
    id,
    title: `nb-${id}`,
    createdAt: 1,
    updatedAt: 1,
    cells: [],
  })
}

// A local copy WITH a sync-state naming an owner (a synced/edited notebook).
const putOwned = async (id: string, ownerId: string) => {
  await putLocalCopy(id)
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
    // The blocker fix: a server notebook merely opened (pulled, no sync-state)
    // must reopen. The old resolver returned null here and fell back elsewhere.
    test('returns the stored id when the local copy has NO sync-state (opened, not stamped)', async () => {
      await putLocalCopy(NB_A)
      writeLastOpenedId(USER.id, NB_A)
      expect(await resolveOwnedLastOpenedId()).toBe(NB_A)
    })

    test('returns the stored id when the local copy is owned by the current user', async () => {
      await putOwned(NB_A, USER.id)
      writeLastOpenedId(USER.id, NB_A)
      expect(await resolveOwnedLastOpenedId()).toBe(NB_A)
    })

    test('returns null when the local copy is stamped with a DIFFERENT owner (negative §11 guard)', async () => {
      // The per-user key says we opened it, but the local copy carries another
      // account's owner — reject rather than risk a cross-account leak.
      await putOwned(NB_A, 'someone-else')
      writeLastOpenedId(USER.id, NB_A)
      expect(await resolveOwnedLastOpenedId()).toBeNull()
    })

    test('returns null when there is no stored id', async () => {
      await putLocalCopy(NB_A)
      expect(await resolveOwnedLastOpenedId()).toBeNull()
    })

    test('returns null when the stored id has no local copy', async () => {
      // Persisted last-opened, but no local notebook with that id (e.g. server
      // only, never pulled). Nothing to open without the network; the resolver
      // does NOT confirm via the server list (no hidden GET).
      writeLastOpenedId(USER.id, NB_A)
      expect(await resolveOwnedLastOpenedId()).toBeNull()
    })

    test('returns null when signed out', async () => {
      await putLocalCopy(NB_A)
      writeLastOpenedId(USER.id, NB_A)
      userAtom.set(null)
      expect(await resolveOwnedLastOpenedId()).toBeNull()
    })
  })

  // Shared device: IndexedDB + localStorage are common to every account. Closes
  // the review's worry that trusting the per-user key could open another
  // account's notebook ("one quiet bug swapped for another").
  describe('resolveOwnedLastOpenedId — shared device (cross-account)', () => {
    test('account A reopens its own last-opened, not account B\u2019s', async () => {
      // B opened NB_B earlier on this device; its copy is stamped owner B.
      await putOwned(NB_B, 'owner-B')
      writeLastOpenedId('owner-B', NB_B)
      // A opened NB_A (pulled, not yet stamped) and is the one signing in now.
      await putLocalCopy(NB_A)
      writeLastOpenedId('owner-A', NB_A)
      userAtom.set({ id: 'owner-A', roles: [] } as never)

      // A's per-user key drives the result; B's key/notebook never leak in.
      expect(await resolveOwnedLastOpenedId()).toBe(NB_A)
    })

    test('does not open a copy stamped for another account even if its id is in A\u2019s key', async () => {
      // Defence-in-depth: should a foreign-owned id ever land in A's key, the
      // negative owner guard still rejects it.
      await putOwned(NB_B, 'owner-B')
      writeLastOpenedId('owner-A', NB_B)
      userAtom.set({ id: 'owner-A', roles: [] } as never)

      expect(await resolveOwnedLastOpenedId()).toBeNull()
    })
  })
})
