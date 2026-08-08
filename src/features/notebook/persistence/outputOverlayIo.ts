// Save / restore orchestration for the local-only output overlay (Step 6
// C1/C6.2). Sits between the pure projection (`outputOverlay.ts`) and the storage
// adapter: it decides WHAT to persist on a run and WHICH persisted outputs are
// still valid on load. Deliberately free of Reatom/run-lifecycle wiring — the
// caller (a later slice) supplies the run outputs and the current cell versions,
// so this logic stays a pair of unit-testable async functions.

import type { OutputItem } from '../runtime/types'
import {
  assembleOverlay,
  projectCellOutputs,
  type PersistedCellOutput,
  type PersistedOutputItem,
} from './outputOverlay'
import type { NotebookStorageAdapter } from './storageAdapter'

/** One cell's outputs from a finished run, version-stamped at run START (C6.2). */
export interface CellRunOutputs {
  cellId: string
  /** `cell.updatedAt()` captured when the run began — not when it finished. */
  sourceUpdatedAt: number
  items: readonly OutputItem[]
}

/**
 * Persist the notebook overlay after a run via a bounded read-modify-write, so a
 * run of some cells never destroys the still-valid persisted outputs of the
 * others (PR #128 review). For each cell CURRENTLY in the notebook
 * (`currentVersions`, in notebook order) the merged record is:
 *
 *   - the freshly-projected run output, if this cell ran AND its content version
 *     is unchanged since run start (`currentVersions` === run-start
 *     `sourceUpdatedAt`) — an edit during the run drops it (C6.2); else
 *   - the EXISTING stored record, if it is still fresh (stored `sourceUpdatedAt`
 *     === the cell's current version) — this preserves cells that were not re-run
 *     (e.g. restored from a prior session or run earlier); else
 *   - nothing (stale or removed cells drop).
 *
 * `assembleOverlay` then re-applies the notebook-wide byte cap. When the merge is
 * empty the record is DELETED rather than left stale. Cells absent from
 * `currentVersions` (no longer in the notebook) are never carried over.
 */
export async function saveNotebookOutputs(
  storage: Pick<NotebookStorageAdapter, 'getOverlay' | 'putOverlay' | 'deleteOverlay'>,
  input: {
    notebookId: string
    savedAt: number
    cells: readonly CellRunOutputs[]
    currentVersions: ReadonlyMap<string, number>
  },
): Promise<void> {
  const { notebookId, savedAt, currentVersions } = input

  // Cells that ran this time — their fresh result is authoritative, so they never
  // fall back to a stored entry (a rerun that produced nothing must CLEAR the
  // cell's prior output, C1; a stale rerun is dropped below).
  const ranThisTime = new Set(input.cells.map((c) => c.cellId))

  // Freshly-projected run records, keyed by cell id (stale run outputs dropped).
  const runById = new Map<string, PersistedCellOutput>()
  for (const cell of input.cells) {
    if (currentVersions.get(cell.cellId) !== cell.sourceUpdatedAt) continue // edited during run
    const projected = projectCellOutputs({ ...cell, savedAt })
    if (projected.items.length > 0) runById.set(cell.cellId, projected)
  }

  // Existing stored records that are still fresh, for cells NOT re-run this time.
  const existing = await storage.getOverlay(notebookId)
  const storedById = new Map((existing?.cells ?? []).map((r) => [r.cellId, r]))

  // Merge in notebook order (currentVersions is built in cell order by the caller).
  const merged: PersistedCellOutput[] = []
  for (const [cellId, version] of currentVersions) {
    const run = runById.get(cellId)
    if (run) {
      merged.push(run)
      continue
    }
    if (ranThisTime.has(cellId)) continue // ran but produced nothing persistable → cleared
    const stored = storedById.get(cellId)
    if (stored && stored.sourceUpdatedAt === version) merged.push(stored)
  }

  const overlay = assembleOverlay(notebookId, savedAt, merged)
  if (overlay.cells.length === 0) {
    await storage.deleteOverlay(notebookId)
    return
  }
  await storage.putOverlay(overlay)
}

/**
 * Load the persisted outputs for a notebook, keeping only those whose saved
 * `sourceUpdatedAt` still equals the cell's CURRENT content version
 * (`currentVersions`). A cell whose source was edited since it last ran (versions
 * differ) — or that no longer exists — drops its stale output (C6.2). Returns a
 * `cellId → items` map for the caller to apply to the live cells; an absent or
 * corrupt overlay yields an empty map (the storage layer already validated it).
 */
export async function restoreNotebookOutputs(
  storage: Pick<NotebookStorageAdapter, 'getOverlay'>,
  notebookId: string,
  currentVersions: ReadonlyMap<string, number>,
): Promise<Map<string, PersistedOutputItem[]>> {
  const restored = new Map<string, PersistedOutputItem[]>()
  const overlay = await storage.getOverlay(notebookId)
  if (!overlay) return restored
  for (const cell of overlay.cells) {
    if (currentVersions.get(cell.cellId) === cell.sourceUpdatedAt) {
      restored.set(cell.cellId, cell.items)
    }
  }
  return restored
}
