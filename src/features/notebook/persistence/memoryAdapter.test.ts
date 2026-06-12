import { describe, expect, test } from 'vitest'
import { FORMAT_VERSION, type NotebookJSON } from './schema'
import { createMemoryAdapter } from './memoryAdapter'
import { indexedDbAdapter } from './indexedDbAdapter'

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

describe('memoryAdapter', () => {
  test('put then get round-trips a notebook', async () => {
    const store = createMemoryAdapter()
    const nb = notebook(ID, 1)
    await store.put(nb)
    expect(await store.get(ID)).toEqual(nb)
  })

  test('get returns undefined for an unknown id', async () => {
    expect(await createMemoryAdapter().get('missing')).toBeUndefined()
  })

  test('put replaces an existing notebook with the same id', async () => {
    const store = createMemoryAdapter()
    await store.put(notebook(ID, 1, 'first'))
    await store.put(notebook(ID, 2, 'second'))
    expect((await store.get(ID))?.title).toBe('second')
    expect(await store.list()).toHaveLength(1)
  })

  test('putIfNewer writes when the stored version matches the caller baseline', async () => {
    const store = createMemoryAdapter()
    await store.put(notebook(ID, 10, 'base'))
    await expect(store.putIfNewer(notebook(ID, 20, 'mine'), 10)).resolves.toEqual({ ok: true })
    expect((await store.get(ID))?.title).toBe('mine')
  })

  test('putIfNewer refuses to overwrite a newer stored version', async () => {
    const store = createMemoryAdapter()
    const otherTab = notebook(ID, 30, 'other tab')
    await store.put(otherTab)
    expect(await store.putIfNewer(notebook(ID, 20, 'stale tab'), 10)).toEqual({
      ok: false,
      current: otherTab,
    })
    expect((await store.get(ID))?.title).toBe('other tab')
  })

  test('putIfNewer with a null baseline writes only into an empty slot', async () => {
    const store = createMemoryAdapter()
    await expect(store.putIfNewer(notebook(ID, 20, 'mine'), null)).resolves.toEqual({ ok: true })
    await expect(store.putIfNewer(notebook(ID, 30, 'other'), null)).resolves.toMatchObject({
      ok: false,
    })
    expect((await store.get(ID))?.title).toBe('mine')
  })

  test('delete removes a notebook', async () => {
    const store = createMemoryAdapter()
    await store.put(notebook(ID, 1))
    await store.delete(ID)
    expect(await store.get(ID)).toBeUndefined()
  })

  test('list returns notebooks most recently edited first', async () => {
    const store = createMemoryAdapter()
    await store.put(notebook('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 100))
    await store.put(notebook('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 300))
    await store.put(notebook('cccccccc-cccc-cccc-cccc-cccccccccccc', 200))
    expect((await store.list()).map((n) => n.updatedAt)).toEqual([300, 200, 100])
  })

  test('clearAll empties the store', async () => {
    const store = createMemoryAdapter()
    await store.put(notebook(ID, 1))
    await store.clearAll()
    expect(await store.list()).toEqual([])
  })

  test('a new instance starts empty — data is lost, not shared across instances', async () => {
    const first = createMemoryAdapter()
    await first.put(notebook(ID, 1))
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
    await store.put(notebook(ID, 1))
    expect(await indexedDbAdapter.get(ID)).toBeUndefined()
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  // Snapshot semantics: the store holds copies, never caller-owned references,
  // so external mutation can never reach back into it (matches IndexedDB).
  describe('snapshot isolation', () => {
    test('put stores a snapshot — mutating the source object leaves the store intact', async () => {
      const store = createMemoryAdapter()
      const source = notebook(ID, 1, 'original')
      await store.put(source)
      source.title = 'mutated'
      source.cells[0].content = 'mutated'
      const stored = await store.get(ID)
      expect(stored?.title).toBe('original')
      expect(stored?.cells[0].content).toBe('x')
    })

    test('get returns a snapshot — mutating the result leaves the store intact', async () => {
      const store = createMemoryAdapter()
      await store.put(notebook(ID, 1, 'original'))
      const first = await store.get(ID)
      if (!first) throw new Error('expected a stored notebook')
      first.title = 'mutated'
      first.cells[0].content = 'mutated'
      expect((await store.get(ID))?.title).toBe('original')
      expect((await store.get(ID))?.cells[0].content).toBe('x')
    })

    test('list returns snapshots — mutating a result element leaves the store intact', async () => {
      const store = createMemoryAdapter()
      await store.put(notebook(ID, 1, 'original'))
      const [first] = await store.list()
      first.title = 'mutated'
      expect((await store.get(ID))?.title).toBe('original')
    })

    test('list returns a fresh array — mutating it leaves the store intact', async () => {
      const store = createMemoryAdapter()
      await store.put(notebook(ID, 1))
      const listed = await store.list()
      listed.push(notebook('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 2))
      listed.length = 0
      expect(await store.list()).toHaveLength(1)
    })

    test('failed putIfNewer returns a snapshot of current — mutating it leaves the store intact', async () => {
      const store = createMemoryAdapter()
      await store.put(notebook(ID, 30, 'stored'))
      const result = await store.putIfNewer(notebook(ID, 20, 'stale'), 10)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        result.current.title = 'mutated'
      }
      expect((await store.get(ID))?.title).toBe('stored')
    })
  })
})
