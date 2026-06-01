import { beforeEach, describe, expect, test } from 'vitest'
import { FORMAT_VERSION, type NotebookJSON } from '@/features/notebook/persistence/schema'
import { clear, get, list, put, remove } from './notebook'

function notebook(id: string, updatedAt: number, title = 'NB'): NotebookJSON {
  return {
    formatVersion: FORMAT_VERSION,
    id,
    title,
    createdAt: 1_700_000_000_000,
    updatedAt,
    cells: [{ id: `${id}-c1`, kind: 'code', content: 'x', updatedAt }],
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
    const db = await openDB('js-notebook', 1)
    await db.put('notebooks', { id: 'broken', title: 42 })
    db.close()
    await expect(get('broken')).rejects.toThrow(/Invalid notebook JSON/)
  })

  test('list skips a corrupt record but returns the valid ones', async () => {
    await put(notebook('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1))
    const { openDB } = await import('idb')
    const db = await openDB('js-notebook', 1)
    await db.put('notebooks', { id: 'broken', updatedAt: 5 })
    db.close()
    const all = await list()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
  })
})
