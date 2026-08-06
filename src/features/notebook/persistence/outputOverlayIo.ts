// Save / restore orchestration for the local-only output overlay (Step 6
// C1/C6.2). Sits between the pure projection (`outputOverlay.ts`) and the storage
// adapter: it decides WHAT to persist on a run and WHICH persisted outputs are
// still valid on load. Deliberately free of Reatom/run-lifecycle wiring — the
// caller (a later slice) supplies the run outputs and the current cell versions,
// so this logic stays a pair of unit-testable async functions.

import type { OutputItem } from '../runtime/types'
import { projectNotebookOverlay, type PersistedOutputItem } from './outputOverlay'
import type { NotebookStorageAdapter } from './storageAdapter'

/** One cell's outputs from a finished run, version-stamped at run START (C6.2). */
export interface CellRunOutputs {
  cellId: string
  /** `cell.updatedAt()` captured when the run began — not when it finished. */
  sourceUpdatedAt: number
  items: readonly OutputItem[]
}

/**
 * Persist the overlay for a notebook from the current set of run outputs,
 * replacing the prior record wholesale (per-run replace, C1). When nothing is
 * persistable — every cell projected to no rich output — the record is DELETED
 * rather than left stale, so a previous run's image never outlives a rerun that
 * produced none.
 *
 * The caller passes ALL cells that carry run output (not just the one that just
 * ran), each with the version captured at ITS run start; `projectNotebookOverlay`
 * then applies the byte caps and the bounded notebook overflow.
 */
export async function saveNotebookOutputs(
  storage: Pick<NotebookStorageAdapter, 'putOverlay' | 'deleteOverlay'>,
  input: { notebookId: string; savedAt: number; cells: readonly CellRunOutputs[] },
): Promise<void> {
  const overlay = projectNotebookOverlay(input)
  if (overlay.cells.length === 0) {
    await storage.deleteOverlay(input.notebookId)
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
