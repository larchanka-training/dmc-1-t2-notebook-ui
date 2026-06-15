import { beforeEach, describe, expect, test } from 'vitest'
import { indexedDbAdapter } from './indexedDbAdapter'
import { createMemoryAdapter } from './memoryAdapter'
import type { NotebookStorageAdapter, NotebookSyncState } from './storageAdapter'
import {
  CELL_ID,
  makeNotebook,
  NOTEBOOK_ID as ID,
  NOTEBOOK_ID_B as ID_B,
  NOTEBOOK_ID_C as ID_C,
} from './__fixtures__/notebook'

function makeSyncState(
  notebookId: string,
  overrides: Partial<NotebookSyncState> = {},
): NotebookSyncState {
  return {
    notebookId,
    remoteCreated: false,
    dirty: true,
    deletedCells: [{ id: CELL_ID, deletedAt: 1_700_000_000_000 }],
    ...overrides,
  }
}

// One contract, two backends. Every shared behaviour is asserted against both
// `indexedDbAdapter` (disk) and `createMemoryAdapter()` (memory), so the two can
// never silently diverge — the divergence the adapter layer exists to prevent.
// Backend-specific behaviour lives in the per-backend suites: disk's
// NewerFormatError rethrow (indexedDbAdapter.test.ts) and memory's volatility +
// browser-storage isolation (memoryAdapter.test.ts).
const backends: { name: string; create: () => Promise<NotebookStorageAdapter> }[] = [
  {
    name: 'indexedDbAdapter',
    create: async () => {
      await indexedDbAdapter.clearAll()
      return indexedDbAdapter
    },
  },
  { name: 'createMemoryAdapter', create: async () => createMemoryAdapter() },
]

describe.each(backends)('NotebookStorageAdapter contract: $name', ({ create }) => {
  let store: NotebookStorageAdapter
  beforeEach(async () => {
    store = await create()
  })

  test('put then get round-trips a notebook', async () => {
    const nb = makeNotebook(ID, 1)
    await store.put(nb)
    expect(await store.get(ID)).toEqual(nb)
  })

  test('get returns undefined for an unknown id', async () => {
    expect(await store.get('missing')).toBeUndefined()
  })

  test('put replaces an existing notebook with the same id', async () => {
    await store.put(makeNotebook(ID, 1, 'first'))
    await store.put(makeNotebook(ID, 2, 'second'))
    expect((await store.get(ID))?.title).toBe('second')
    expect(await store.list()).toHaveLength(1)
  })

  test('putIfNewer writes when the stored version matches the caller baseline', async () => {
    await store.put(makeNotebook(ID, 10, 'base'))
    await expect(store.putIfNewer(makeNotebook(ID, 20, 'mine'), 10)).resolves.toEqual({ ok: true })
    expect((await store.get(ID))?.title).toBe('mine')
  })

  test('putIfNewer refuses to overwrite a newer stored version', async () => {
    const newer = makeNotebook(ID, 30, 'other tab')
    await store.put(newer)
    expect(await store.putIfNewer(makeNotebook(ID, 20, 'stale tab'), 10)).toEqual({
      ok: false,
      current: newer,
    })
    expect((await store.get(ID))?.title).toBe('other tab')
  })

  test('putIfNewer with a null baseline writes only into an empty slot', async () => {
    await expect(store.putIfNewer(makeNotebook(ID, 20, 'mine'), null)).resolves.toEqual({
      ok: true,
    })
    await expect(store.putIfNewer(makeNotebook(ID, 30, 'other'), null)).resolves.toMatchObject({
      ok: false,
    })
    expect((await store.get(ID))?.title).toBe('mine')
  })

  test('delete removes a notebook', async () => {
    await store.put(makeNotebook(ID, 1))
    await store.delete(ID)
    expect(await store.get(ID)).toBeUndefined()
  })

  test('clearAll empties the store', async () => {
    await store.put(makeNotebook(ID, 1))
    await store.clearAll()
    expect(await store.list()).toEqual([])
  })

  // --- Sync-metadata partition (#134) -------------------------------------

  test('putSyncState then getSyncState round-trips', async () => {
    const state = makeSyncState(ID)
    await store.putSyncState(state)
    expect(await store.getSyncState(ID)).toEqual(state)
  })

  test('getSyncState returns undefined for an unknown id', async () => {
    expect(await store.getSyncState('missing')).toBeUndefined()
  })

  test('putSyncState replaces an existing record with the same id', async () => {
    await store.putSyncState(makeSyncState(ID, { dirty: true }))
    await store.putSyncState(makeSyncState(ID, { dirty: false, remoteCreated: true }))
    const stored = await store.getSyncState(ID)
    expect(stored).toMatchObject({ dirty: false, remoteCreated: true })
  })

  test('deleteSyncState removes the record', async () => {
    await store.putSyncState(makeSyncState(ID))
    await store.deleteSyncState(ID)
    expect(await store.getSyncState(ID)).toBeUndefined()
  })

  test('sync state lives in a partition separate from notebook content', async () => {
    await store.put(makeNotebook(ID, 1))
    await store.putSyncState(makeSyncState(ID))
    // Deleting the notebook must not drop its sync state, and vice versa.
    await store.delete(ID)
    expect(await store.getSyncState(ID)).toBeDefined()
    expect(await store.get(ID)).toBeUndefined()
  })

  test('clearAll wipes notebooks AND sync state in one call', async () => {
    await store.put(makeNotebook(ID, 1))
    await store.putSyncState(makeSyncState(ID))
    await store.clearAll()
    expect(await store.list()).toEqual([])
    expect(await store.getSyncState(ID)).toBeUndefined()
  })

  test('mutating the object passed to putSyncState does not change the store', async () => {
    const source = makeSyncState(ID)
    await store.putSyncState(source)
    source.dirty = false
    source.deletedCells[0].deletedAt = 0
    const stored = await store.getSyncState(ID)
    expect(stored?.dirty).toBe(true)
    expect(stored?.deletedCells[0].deletedAt).toBe(1_700_000_000_000)
  })

  test('list returns notebooks most recently edited first', async () => {
    await store.put(makeNotebook(ID, 100))
    await store.put(makeNotebook(ID_B, 300))
    await store.put(makeNotebook(ID_C, 200))
    expect((await store.list()).map((n) => n.updatedAt)).toEqual([300, 200, 100])
  })

  test('list breaks updatedAt ties by id descending — identical on both backends', async () => {
    // Insert A before B, both with the same updatedAt: a backend that fell back
    // to insertion order would return [A, B]; the contract is id-descending [B, A].
    await store.put(makeNotebook(ID, 100)) // id aaaa…
    await store.put(makeNotebook(ID_B, 100)) // id bbbb…
    expect((await store.list()).map((n) => n.id)).toEqual([ID_B, ID])
  })

  // Snapshot / return isolation: the store holds copies, never caller-owned
  // references (IndexedDB structured-clones; memory clones explicitly), so
  // external mutation can never reach back into it.
  test('mutating the object passed to put does not change the store', async () => {
    const source = makeNotebook(ID, 1, 'original')
    await store.put(source)
    source.title = 'mutated'
    source.cells[0].content = 'mutated'
    const stored = await store.get(ID)
    expect(stored?.title).toBe('original')
    expect(stored?.cells[0].content).toBe('x')
  })

  test('mutating a get result does not change the store', async () => {
    await store.put(makeNotebook(ID, 1, 'original'))
    const first = await store.get(ID)
    if (!first) throw new Error('expected a stored notebook')
    first.title = 'mutated'
    expect((await store.get(ID))?.title).toBe('original')
  })

  test('mutating a list result element does not change the store', async () => {
    await store.put(makeNotebook(ID, 1, 'original'))
    const [first] = await store.list()
    first.title = 'mutated'
    expect((await store.get(ID))?.title).toBe('original')
  })

  test('mutating the array returned by list does not change the store', async () => {
    await store.put(makeNotebook(ID, 1))
    const listed = await store.list()
    listed.push(makeNotebook(ID_B, 2))
    listed.length = 0
    expect(await store.list()).toHaveLength(1)
  })

  test('mutating failed-CAS current does not change the store', async () => {
    await store.put(makeNotebook(ID, 30, 'stored'))
    const result = await store.putIfNewer(makeNotebook(ID, 20, 'stale'), 10)
    expect(result.ok).toBe(false)
    if (!result.ok) result.current.title = 'mutated'
    expect((await store.get(ID))?.title).toBe('stored')
  })
})
