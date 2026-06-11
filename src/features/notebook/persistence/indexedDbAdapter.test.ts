import { beforeEach, describe, expect, test } from 'vitest'
import { FORMAT_VERSION, type NotebookJSON } from './schema'
import { indexedDbAdapter } from './indexedDbAdapter'

// Cell id must be a UUID (schema validates `format: uuid`); notebooks here are
// keyed/asserted by their own id, so a single fixed cell UUID is enough.
const CELL_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

function notebook(id: string, updatedAt: number, title = 'NB'): NotebookJSON {
  return {
    formatVersion: FORMAT_VERSION,
    id,
    title,
    createdAt: 1_700_000_000_000,
    updatedAt,
    cells: [{ id: CELL_ID, kind: 'code', content: 'x', updatedAt }],
  }
}

// Verifies the contract through the disk adapter (`delete` / `clearAll`); the
// low-level IndexedDB module is covered separately by storage.test.ts.
describe('indexedDbAdapter', () => {
  beforeEach(async () => {
    await indexedDbAdapter.clearAll()
  })

  test('put then get round-trips a notebook', async () => {
    const nb = notebook(ID, 1)
    await indexedDbAdapter.put(nb)
    expect(await indexedDbAdapter.get(nb.id)).toEqual(nb)
  })

  test('get returns undefined for an unknown id', async () => {
    expect(await indexedDbAdapter.get('missing')).toBeUndefined()
  })

  test('putIfNewer writes when the stored version matches the caller baseline', async () => {
    await indexedDbAdapter.put(notebook(ID, 10, 'base'))
    await expect(indexedDbAdapter.putIfNewer(notebook(ID, 20, 'mine'), 10)).resolves.toEqual({
      ok: true,
    })
    expect((await indexedDbAdapter.get(ID))?.title).toBe('mine')
  })

  test('putIfNewer refuses to overwrite a newer stored version', async () => {
    const otherTab = notebook(ID, 30, 'other tab')
    await indexedDbAdapter.put(otherTab)
    const result = await indexedDbAdapter.putIfNewer(notebook(ID, 20, 'stale tab'), 10)
    expect(result).toEqual({ ok: false, current: otherTab })
    expect((await indexedDbAdapter.get(ID))?.title).toBe('other tab')
  })

  test('putIfNewer with a null baseline writes only into an empty slot', async () => {
    await expect(indexedDbAdapter.putIfNewer(notebook(ID, 20, 'mine'), null)).resolves.toEqual({
      ok: true,
    })
    await expect(
      indexedDbAdapter.putIfNewer(notebook(ID, 30, 'other'), null),
    ).resolves.toMatchObject({ ok: false })
    expect((await indexedDbAdapter.get(ID))?.title).toBe('mine')
  })

  test('putIfNewer rethrows newer-format storage instead of downgrading it', async () => {
    const { openDB } = await import('idb')
    const db = await openDB('js-notebook', 1)
    await db.put('notebooks', {
      ...notebook(ID, FORMAT_VERSION + 1, 'future'),
      formatVersion: FORMAT_VERSION + 1,
    })
    db.close()
    await expect(indexedDbAdapter.putIfNewer(notebook(ID, 20, 'old app'), 10)).rejects.toThrow(
      /newer format version/,
    )
  })

  test('delete removes a notebook', async () => {
    await indexedDbAdapter.put(notebook(ID, 1))
    await indexedDbAdapter.delete(ID)
    expect(await indexedDbAdapter.get(ID)).toBeUndefined()
  })

  test('list returns notebooks most recently edited first', async () => {
    await indexedDbAdapter.put(notebook('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 100))
    await indexedDbAdapter.put(notebook('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 300))
    await indexedDbAdapter.put(notebook('cccccccc-cccc-cccc-cccc-cccccccccccc', 200))
    expect((await indexedDbAdapter.list()).map((n) => n.updatedAt)).toEqual([300, 200, 100])
  })

  test('clearAll empties the store', async () => {
    await indexedDbAdapter.put(notebook(ID, 1))
    await indexedDbAdapter.clearAll()
    expect(await indexedDbAdapter.list()).toEqual([])
  })
})
