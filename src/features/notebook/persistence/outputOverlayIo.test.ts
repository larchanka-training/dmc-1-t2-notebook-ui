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
      currentVersions: new Map([['a', 1]]),
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
      currentVersions: new Map([['a', 1]]),
    })
    await saveNotebookOutputs(store, {
      notebookId: NB,
      savedAt: 2,
      cells: [{ cellId: 'b', sourceUpdatedAt: 1, items: [result(2)] }],
      currentVersions: new Map([['b', 1]]),
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
      currentVersions: new Map([['a', 1]]),
    })
    expect(await store.getOverlay(NB)).toBeDefined()
    // A rerun that produced only streams → overlay is cleared, not left stale.
    await saveNotebookOutputs(store, {
      notebookId: NB,
      savedAt: 2,
      cells: [{ cellId: 'a', sourceUpdatedAt: 1, items: [stdout('logs only')] }],
      currentVersions: new Map([['a', 1]]),
    })
    expect(await store.getOverlay(NB)).toBeUndefined()
  })

  test('drops a cell whose source changed DURING the run (edit-during-run, C6.2)', async () => {
    // Run started at version 1, but the cell is now at version 2 → not persisted.
    await saveNotebookOutputs(store, {
      notebookId: NB,
      savedAt: 1,
      cells: [{ cellId: 'a', sourceUpdatedAt: 1, items: [image('AAAA')] }],
      currentVersions: new Map([['a', 2]]),
    })
    expect(await store.getOverlay(NB)).toBeUndefined()
  })

  test('running one cell preserves another cell’s still-fresh stored output (PR #128)', async () => {
    // Seed A + B.
    await saveNotebookOutputs(store, {
      notebookId: NB,
      savedAt: 1,
      cells: [
        { cellId: 'a', sourceUpdatedAt: 10, items: [image('AAAA')] },
        { cellId: 'b', sourceUpdatedAt: 20, items: [result(2)] },
      ],
      currentVersions: new Map([
        ['a', 10],
        ['b', 20],
      ]),
    })
    // Re-run ONLY A (B untouched but still present + fresh).
    await saveNotebookOutputs(store, {
      notebookId: NB,
      savedAt: 2,
      cells: [{ cellId: 'a', sourceUpdatedAt: 10, items: [image('BBBB')] }],
      currentVersions: new Map([
        ['a', 10],
        ['b', 20],
      ]),
    })
    const overlay = await store.getOverlay(NB)
    expect(overlay?.cells.map((c) => c.cellId)).toEqual(['a', 'b'])
    // A replaced with its new output; B preserved.
    expect(overlay?.cells.find((c) => c.cellId === 'a')?.items[0]).toMatchObject({ data: 'BBBB' })
    expect(overlay?.cells.find((c) => c.cellId === 'b')?.items[0]).toMatchObject({ type: 'result' })
  })

  test('a stored cell edited since it ran is dropped even if not re-run', async () => {
    await saveNotebookOutputs(store, {
      notebookId: NB,
      savedAt: 1,
      cells: [
        { cellId: 'a', sourceUpdatedAt: 10, items: [image('AAAA')] },
        { cellId: 'b', sourceUpdatedAt: 20, items: [result(2)] },
      ],
      currentVersions: new Map([
        ['a', 10],
        ['b', 20],
      ]),
    })
    // Re-run A; B was edited (now v21) but not re-run → its stored output is stale.
    await saveNotebookOutputs(store, {
      notebookId: NB,
      savedAt: 2,
      cells: [{ cellId: 'a', sourceUpdatedAt: 10, items: [image('AAAA')] }],
      currentVersions: new Map([
        ['a', 10],
        ['b', 21],
      ]),
    })
    const overlay = await store.getOverlay(NB)
    expect(overlay?.cells.map((c) => c.cellId)).toEqual(['a'])
  })

  test('persists only the still-fresh cells when some changed during their run', async () => {
    await saveNotebookOutputs(store, {
      notebookId: NB,
      savedAt: 1,
      cells: [
        { cellId: 'a', sourceUpdatedAt: 1, items: [result(1)] }, // stale (now v2)
        { cellId: 'b', sourceUpdatedAt: 5, items: [result(2)] }, // fresh
      ],
      currentVersions: new Map([
        ['a', 2],
        ['b', 5],
      ]),
    })
    const overlay = await store.getOverlay(NB)
    expect(overlay?.cells.map((c) => c.cellId)).toEqual(['b'])
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
      currentVersions: new Map([
        ['a', 10],
        ['b', 20],
      ]),
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
      currentVersions: new Map([['a', 30]]),
    })
    const restored = await restoreNotebookOutputs(store, NB, new Map([['a', 30]]))
    const items = restored.get('a')!
    expect(isOutputTooLarge(items[0] as OutputItem)).toBe(true)
  })
})
