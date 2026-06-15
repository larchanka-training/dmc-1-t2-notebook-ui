import { describe, expect, test } from 'vitest'
import { createMemoryAdapter } from './memoryAdapter'
import { indexedDbAdapter } from './indexedDbAdapter'
import { makeNotebook, NOTEBOOK_ID as ID } from './__fixtures__/notebook'

// Shared CRUD + snapshot-isolation behaviour is covered for both backends in
// adapterContract.test.ts. This suite keeps only what is specific to the
// in-memory backend: volatility across instances and never touching browser
// storage.
describe('memoryAdapter (memory-specific)', () => {
  test('a new instance starts empty — data is lost, not shared across instances', async () => {
    const first = createMemoryAdapter()
    await first.put(makeNotebook(ID, 1))
    const second = createMemoryAdapter()
    expect(await second.get(ID)).toBeUndefined()
    expect(await second.list()).toEqual([])
    // The original instance keeps its data: stores are isolated, not global.
    expect(await first.get(ID)).toBeDefined()
  })

  test('does not write notebook content to IndexedDB, localStorage or sessionStorage', async () => {
    await indexedDbAdapter.clearAll()
    localStorage.clear()
    sessionStorage.clear()
    const store = createMemoryAdapter()
    await store.put(makeNotebook(ID, 1))
    expect(await indexedDbAdapter.get(ID)).toBeUndefined()
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })
})
