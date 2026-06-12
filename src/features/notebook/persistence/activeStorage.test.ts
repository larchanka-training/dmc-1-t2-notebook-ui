import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { FORMAT_VERSION, type NotebookJSON } from './schema'
import { indexedDbAdapter } from './indexedDbAdapter'
import { clearLocalNotebookData, getActiveNotebookStorage, notebookStorage } from './activeStorage'

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

describe('activeStorage facade', () => {
  beforeEach(async () => {
    await notebookStorage.clearAll()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('defaults to the IndexedDB backend', () => {
    expect(getActiveNotebookStorage()).toBe(indexedDbAdapter)
  })

  test('delegates writes and reads to the active (disk) backend', async () => {
    await notebookStorage.put(notebook(ID, 1))
    // Visible through the concrete disk adapter — proves the write reached IndexedDB.
    expect(await indexedDbAdapter.get(ID)).toBeDefined()
    expect(await notebookStorage.get(ID)).toEqual(await indexedDbAdapter.get(ID))
  })

  test('delegates putIfNewer — success into an empty slot, conflict against a newer record', async () => {
    await expect(notebookStorage.putIfNewer(notebook(ID, 20, 'mine'), null)).resolves.toEqual({
      ok: true,
    })
    const result = await notebookStorage.putIfNewer(notebook(ID, 10, 'stale'), 5)
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.current.title).toBe('mine')
  })

  test('delegates delete to the active backend', async () => {
    await notebookStorage.put(notebook(ID, 1))
    await notebookStorage.delete(ID)
    expect(await indexedDbAdapter.get(ID)).toBeUndefined()
  })

  test('delegates list, most recently edited first', async () => {
    await notebookStorage.put(notebook('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 100))
    await notebookStorage.put(notebook('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 300))
    expect((await notebookStorage.list()).map((n) => n.updatedAt)).toEqual([300, 100])
  })

  test('propagates a backend failure through the delegate', async () => {
    vi.spyOn(indexedDbAdapter, 'put').mockRejectedValue(new Error('blocked DB'))
    await expect(notebookStorage.put(notebook(ID, 1))).rejects.toThrow('blocked DB')
  })

  test('clearLocalNotebookData erases notebook content from disk', async () => {
    await notebookStorage.put(notebook(ID, 1))
    await clearLocalNotebookData()
    expect(await indexedDbAdapter.get(ID)).toBeUndefined()
    expect(await notebookStorage.list()).toEqual([])
  })
})
