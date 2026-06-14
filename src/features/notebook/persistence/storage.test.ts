import { beforeEach, describe, expect, test } from 'vitest'
import { FORMAT_VERSION, type NotebookJSON } from './schema'
import { MAX_DELETED_CELLS, type NotebookSyncState } from './storageAdapter'
import { clear, get, getSyncState, list, put, putIfNewer, putSyncState, remove } from './storage'

// Cell id must be a UUID (schema validates `format: uuid`); notebooks here are
// keyed/asserted by their own id, so a single fixed cell UUID is enough.
const CELL_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

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

describe('notebook IndexedDB storage', () => {
  beforeEach(async () => {
    await clear()
  })

  test('put then get round-trips a notebook', async () => {
    const nb = notebook('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1)
    await put(nb)
    expect(await get(nb.id)).toEqual(nb)
  })

  test('get returns undefined for an unknown id', async () => {
    expect(await get('missing')).toBeUndefined()
  })

  test('put replaces an existing notebook with the same id', async () => {
    const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    await put(notebook(id, 1, 'first'))
    await put(notebook(id, 2, 'second'))
    expect((await get(id))?.title).toBe('second')
    expect(await list()).toHaveLength(1)
  })

  test('putIfNewer writes when the stored version matches the caller baseline', async () => {
    const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    await put(notebook(id, 10, 'base'))
    await expect(putIfNewer(notebook(id, 20, 'mine'), 10)).resolves.toEqual({ ok: true })
    expect((await get(id))?.title).toBe('mine')
  })

  test('putIfNewer refuses to overwrite a newer stored version', async () => {
    const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    const otherTab = notebook(id, 30, 'other tab')
    await put(otherTab)
    const result = await putIfNewer(notebook(id, 20, 'stale tab'), 10)
    expect(result).toEqual({ ok: false, current: otherTab })
    expect((await get(id))?.title).toBe('other tab')
  })

  test('putIfNewer rethrows newer-format storage instead of downgrading it', async () => {
    const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    const { openDB } = await import('idb')
    const db = await openDB('js-notebook')
    await db.put('notebooks', {
      ...notebook(id, FORMAT_VERSION + 1, 'future'),
      formatVersion: FORMAT_VERSION + 1,
    })
    db.close()
    await expect(putIfNewer(notebook(id, 20, 'old app'), 10)).rejects.toThrow(
      /newer format version/,
    )
  })

  test('putIfNewer with a null baseline writes only into an empty slot', async () => {
    const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    const mine = notebook(id, 20, 'mine')
    await expect(putIfNewer(mine, null)).resolves.toEqual({ ok: true })
    expect((await get(id))?.title).toBe('mine')
    await expect(putIfNewer(notebook(id, 30, 'other'), null)).resolves.toMatchObject({ ok: false })
    expect((await get(id))?.title).toBe('mine')
  })

  test('list returns notebooks most recently edited first', async () => {
    await put(notebook('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 100))
    await put(notebook('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 300))
    await put(notebook('cccccccc-cccc-cccc-cccc-cccccccccccc', 200))
    const ids = (await list()).map((n) => n.updatedAt)
    expect(ids).toEqual([300, 200, 100])
  })

  test('remove deletes a notebook', async () => {
    const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    await put(notebook(id, 1))
    await remove(id)
    expect(await get(id)).toBeUndefined()
  })

  test('get rejects a structurally invalid stored record', async () => {
    // Write a broken record straight to IDB, bypassing put()'s typing.
    const { openDB } = await import('idb')
    const db = await openDB('js-notebook')
    await db.put('notebooks', { id: 'broken', title: 42 })
    db.close()
    await expect(get('broken')).rejects.toThrow(/Invalid notebook JSON/)
  })

  test('list skips a corrupt record but returns the valid ones', async () => {
    await put(notebook('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1))
    const { openDB } = await import('idb')
    const db = await openDB('js-notebook')
    await db.put('notebooks', { id: 'broken', updatedAt: 5 })
    db.close()
    const all = await list()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
  })

  test('sync state round-trips a bounded tombstone queue with an overflow marker', async () => {
    const state: NotebookSyncState = {
      notebookId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      remoteCreated: true,
      dirty: true,
      ownerId: '33333333-3333-4333-8333-333333333333',
      deletedCells: Array.from({ length: MAX_DELETED_CELLS }, (_, i) => ({
        id: `00000000-0000-4000-8000-${i.toString().padStart(12, '0')}`,
        deletedAt: i + 1,
      })),
      tombstonesOverflow: true,
      lastSyncedUpdatedAt: 10,
    }

    await putSyncState(state)

    expect(await getSyncState(state.notebookId)).toEqual(state)
  })
})
