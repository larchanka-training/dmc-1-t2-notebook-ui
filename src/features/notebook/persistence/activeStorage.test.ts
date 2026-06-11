import { beforeEach, describe, expect, test } from 'vitest'
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

  test('defaults to the IndexedDB backend', () => {
    expect(getActiveNotebookStorage()).toBe(indexedDbAdapter)
  })

  test('delegates writes and reads to the active (disk) backend', async () => {
    await notebookStorage.put(notebook(ID, 1))
    // Visible through the concrete disk adapter — proves the write reached IndexedDB.
    expect(await indexedDbAdapter.get(ID)).toBeDefined()
    expect(await notebookStorage.get(ID)).toEqual(await indexedDbAdapter.get(ID))
  })

  test('clearLocalNotebookData erases notebook content from disk', async () => {
    await notebookStorage.put(notebook(ID, 1))
    await clearLocalNotebookData()
    expect(await indexedDbAdapter.get(ID)).toBeUndefined()
    expect(await notebookStorage.list()).toEqual([])
  })
})
