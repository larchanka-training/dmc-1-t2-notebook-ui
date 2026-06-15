import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { indexedDbAdapter } from './indexedDbAdapter'
import { clearLocalNotebookData, getActiveNotebookStorage, notebookStorage } from './activeStorage'
import {
  makeNotebook as notebook,
  NOTEBOOK_ID as ID,
  NOTEBOOK_ID_B as ID_B,
} from './__fixtures__/notebook'

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
    await notebookStorage.put(notebook(ID, 100))
    await notebookStorage.put(notebook(ID_B, 300))
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
