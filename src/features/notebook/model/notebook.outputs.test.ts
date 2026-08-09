import { beforeEach, describe, expect, test } from 'vitest'
import { applyPersistedOutputs, cellsAtom, restoreNotebook } from './notebook'
import { notebookStorage } from '../persistence/activeStorage'
import { FORMAT_VERSION, type NotebookJSON } from '../persistence/schema'
import type { NotebookOutputOverlay } from '../persistence/outputOverlay'

const NB_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const CELL_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const IMAGE = { type: 'image', mime: 'image/png', data: 'AAAA' } as const

const notebook = (cellUpdatedAt: number): NotebookJSON => ({
  formatVersion: FORMAT_VERSION,
  id: NB_ID,
  title: 'NB',
  createdAt: 1,
  updatedAt: cellUpdatedAt,
  cells: [{ id: CELL_ID, kind: 'code', content: 'x', updatedAt: cellUpdatedAt }],
})

const overlay = (sourceUpdatedAt: number): NotebookOutputOverlay => ({
  notebookId: NB_ID,
  savedAt: 1,
  overflow: null,
  cells: [{ cellId: CELL_ID, sourceUpdatedAt, savedAt: 1, items: [IMAGE] }],
})

const outputFor = (id: string) =>
  cellsAtom()
    .find((c) => c.id === id)
    ?.output()

describe('applyPersistedOutputs — restore-on-load (Step 6 C6.2)', () => {
  beforeEach(async () => {
    await notebookStorage.clearAll()
  })

  test('hydrates persisted outputs for a cell whose version still matches', async () => {
    await notebookStorage.putOverlay(overlay(5))
    restoreNotebook(notebook(5)) // loads cells + points the slot at NB_ID
    await applyPersistedOutputs(NB_ID, new Map([[CELL_ID, 5]]))
    expect(outputFor(CELL_ID)).toContainEqual(IMAGE)
  })

  test('does not restore an output whose cell was edited since it ran', async () => {
    await notebookStorage.putOverlay(overlay(5)) // saved at version 5
    restoreNotebook(notebook(6)) // loaded cell is now at version 6 → stale
    await applyPersistedOutputs(NB_ID, new Map([[CELL_ID, 6]]))
    expect(outputFor(CELL_ID)).toEqual([])
  })

  test('no overlay → cells keep empty output', async () => {
    restoreNotebook(notebook(5))
    await applyPersistedOutputs(NB_ID, new Map([[CELL_ID, 5]]))
    expect(outputFor(CELL_ID)).toEqual([])
  })

  test('ignores the restore if the slot switched during the read', async () => {
    await notebookStorage.putOverlay(overlay(5))
    restoreNotebook(notebook(5))
    // A different notebook id than the currently-loaded slot → no-op.
    await applyPersistedOutputs('ffffffff-ffff-4fff-8fff-ffffffffffff', new Map([[CELL_ID, 5]]))
    expect(outputFor(CELL_ID)).toEqual([])
  })

  test('same-id ABA: does not attach a v5 output to a cell now at v6', async () => {
    // The overlay + caller snapshot are validated for version 5, but the LIVE
    // cell was replaced with version 6 while the read was in flight (same id).
    // The notebook-id fence alone would pass; the per-cell version guard must
    // still drop the stale output (C6.2). Passing the pre-read v5 snapshot to a
    // slot already holding the v6 cell reproduces that interleaving deterministically.
    await notebookStorage.putOverlay(overlay(5))
    restoreNotebook(notebook(6)) // slot now holds the v6 cell, same NB_ID
    await applyPersistedOutputs(NB_ID, new Map([[CELL_ID, 5]]))
    expect(outputFor(CELL_ID)).toEqual([])
  })
})
