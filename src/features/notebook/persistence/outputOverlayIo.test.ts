import { beforeEach, describe, expect, test } from 'vitest'
import type { OutputItem } from '../runtime/types'
import { createMemoryAdapter } from './memoryAdapter'
import { isOutputTooLarge } from './outputOverlay'
import { restoreNotebookOutputs, saveNotebookOutputs } from './outputOverlayIo'
import type { NotebookStorageAdapter } from './storageAdapter'

const NB = 'nb'
const image = (data: string): OutputItem => ({ type: 'image', mime: 'image/png', data })
const result = (value: number): OutputItem => ({
  type: 'result',
  value: { kind: 'primitive', value },
})
const stdout = (text: string): OutputItem => ({ type: 'stdout', text })

let store: NotebookStorageAdapter
beforeEach(() => {
  store = createMemoryAdapter()
})

describe('saveNotebookOutputs', () => {
  test('persists an overlay projected from the run outputs', async () => {
    await saveNotebookOutputs(store, {
      notebookId: NB,
      savedAt: 5,
      cells: [{ cellId: 'a', sourceUpdatedAt: 1, items: [result(1), image('AAAA')] }],
    })
    const overlay = await store.getOverlay(NB)
    expect(overlay?.cells.map((c) => c.cellId)).toEqual(['a'])
    expect(overlay?.cells[0]?.sourceUpdatedAt).toBe(1)
  })

  test('replaces the prior overlay on a subsequent save (per-run replace)', async () => {
    await saveNotebookOutputs(store, {
      notebookId: NB,
      savedAt: 1,
      cells: [{ cellId: 'a', sourceUpdatedAt: 1, items: [result(1)] }],
    })
    await saveNotebookOutputs(store, {
      notebookId: NB,
      savedAt: 2,
      cells: [{ cellId: 'b', sourceUpdatedAt: 1, items: [result(2)] }],
    })
    const overlay = await store.getOverlay(NB)
    expect(overlay?.cells.map((c) => c.cellId)).toEqual(['b'])
    expect(overlay?.savedAt).toBe(2)
  })

  test('deletes the record when nothing is persistable (no stale image survives)', async () => {
    await saveNotebookOutputs(store, {
      notebookId: NB,
      savedAt: 1,
      cells: [{ cellId: 'a', sourceUpdatedAt: 1, items: [image('AAAA')] }],
    })
    expect(await store.getOverlay(NB)).toBeDefined()
    // A rerun that produced only streams → overlay is cleared, not left stale.
    await saveNotebookOutputs(store, {
      notebookId: NB,
      savedAt: 2,
      cells: [{ cellId: 'a', sourceUpdatedAt: 1, items: [stdout('logs only')] }],
    })
    expect(await store.getOverlay(NB)).toBeUndefined()
  })
})

describe('restoreNotebookOutputs', () => {
  beforeEach(async () => {
    await saveNotebookOutputs(store, {
      notebookId: NB,
      savedAt: 1,
      cells: [
        { cellId: 'a', sourceUpdatedAt: 10, items: [image('AAAA')] },
        { cellId: 'b', sourceUpdatedAt: 20, items: [result(2)] },
      ],
    })
  })

  test('restores outputs for cells whose version still matches', async () => {
    const restored = await restoreNotebookOutputs(
      store,
      NB,
      new Map([
        ['a', 10],
        ['b', 20],
      ]),
    )
    expect([...restored.keys()].sort()).toEqual(['a', 'b'])
    expect(restored.get('a')?.[0]).toMatchObject({ type: 'image' })
  })

  test('drops a cell whose source was edited since it ran (stale, C6.2)', async () => {
    const restored = await restoreNotebookOutputs(
      store,
      NB,
      new Map([
        ['a', 11], // edited after run (10 → 11)
        ['b', 20],
      ]),
    )
    expect([...restored.keys()]).toEqual(['b'])
  })

  test('drops a cell that no longer exists', async () => {
    const restored = await restoreNotebookOutputs(store, NB, new Map([['b', 20]]))
    expect([...restored.keys()]).toEqual(['b'])
  })

  test('empty map for an absent overlay', async () => {
    const restored = await restoreNotebookOutputs(store, 'other', new Map())
    expect(restored.size).toBe(0)
  })

  test('an OutputTooLarge placeholder round-trips through restore', async () => {
    const huge = 'A'.repeat(3 * 1024 * 1024) // > 2 MiB image cap
    await saveNotebookOutputs(store, {
      notebookId: NB,
      savedAt: 3,
      cells: [{ cellId: 'a', sourceUpdatedAt: 30, items: [image(huge)] }],
    })
    const restored = await restoreNotebookOutputs(store, NB, new Map([['a', 30]]))
    const items = restored.get('a')!
    expect(isOutputTooLarge(items[0] as OutputItem)).toBe(true)
  })
})
