// INV-1 regression: an existing on-disk notebook must survive the v1→v2 schema
// bump (#134 added the `sync` store). Many users already have the single
// local-only notebook in IndexedDB but not on the backend — losing it on upgrade
// would be data loss. This test recreates the pre-#134 v1 layout, writes a
// notebook, then opens through the adapter (v2) and asserts the notebook is
// intact and the new sync partition works.
//
// Own file on purpose: the migration must run as the *first* DB open, so nothing
// here may open `js-notebook` at v2 before the v1 DB is seeded (no `clearAll()`
// in a `beforeEach`).
import { openDB } from 'idb'
import { expect, test } from 'vitest'
import { indexedDbAdapter } from './indexedDbAdapter'
import { makeNotebook, NOTEBOOK_ID as ID } from './__fixtures__/notebook'
import type { NotebookSyncState } from './storageAdapter'

test('an existing v1 DB survives the v2 migration and gains the sync partition', async () => {
  // Recreate the exact v1 layout the pre-#134 code shipped: a single `notebooks`
  // store with an `updatedAt` index, no `sync` store.
  const v1 = await openDB('js-notebook', 1, {
    upgrade(db) {
      const store = db.createObjectStore('notebooks', { keyPath: 'id' })
      store.createIndex('updatedAt', 'updatedAt')
    },
  })
  const precious = makeNotebook(ID, 5, 'local-only notebook')
  await v1.put('notebooks', precious)
  v1.close()

  // First adapter call opens at DB_VERSION 2 → runs the additive migration.
  expect(await indexedDbAdapter.get(ID)).toEqual(precious) // notebook untouched

  // The new sync-metadata partition exists and round-trips.
  const state: NotebookSyncState = {
    notebookId: ID,
    remoteCreated: false,
    dirty: true,
    deletedCells: [],
  }
  await indexedDbAdapter.putSyncState(state)
  expect(await indexedDbAdapter.getSyncState(ID)).toEqual(state)

  // And the migrated notebook is still listed alongside the new partition.
  expect((await indexedDbAdapter.list()).map((n) => n.id)).toEqual([ID])
})
