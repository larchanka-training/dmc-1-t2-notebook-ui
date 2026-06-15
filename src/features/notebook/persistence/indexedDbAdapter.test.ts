import { beforeEach, describe, expect, test } from 'vitest'
import { FORMAT_VERSION } from './schema'
import { indexedDbAdapter } from './indexedDbAdapter'
import { makeNotebook, NOTEBOOK_ID as ID } from './__fixtures__/notebook'

// Shared CRUD / contract behaviour is covered once for both backends in
// adapterContract.test.ts. This suite keeps only what is specific to the on-disk
// backend: surfacing a newer-format stored record as a NewerFormatError instead
// of silently downgrading it (memory can never hold a foreign-format record, so
// it has no equivalent path).
describe('indexedDbAdapter (disk-specific)', () => {
  beforeEach(async () => {
    await indexedDbAdapter.clearAll()
  })

  test('putIfNewer rethrows newer-format storage instead of downgrading it', async () => {
    const { openDB } = await import('idb')
    // Open at the DB's current version (v2 since #134) — `beforeEach` already
    // created it, so pinning version 1 here would throw a VersionError.
    const db = await openDB('js-notebook')
    await db.put('notebooks', {
      ...makeNotebook(ID, FORMAT_VERSION + 1, 'future'),
      formatVersion: FORMAT_VERSION + 1,
    })
    db.close()
    await expect(indexedDbAdapter.putIfNewer(makeNotebook(ID, 20, 'old app'), 10)).rejects.toThrow(
      /newer format version/,
    )
  })
})
