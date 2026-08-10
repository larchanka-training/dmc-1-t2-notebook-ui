// The versioned DTO for JSON export (graphical-output-contract.md §6 C3/C6.1).
//
// Rich outputs must NEVER be folded back into `NotebookJSON`: that type is also
// the autosync WIRE contract (a 1 MiB-capped payload pushed to the server), so
// carrying images/html there would blow the cap and leak local render state onto
// the wire. Export therefore emits a DISTINCT, versioned envelope — the plain
// `NotebookJSON` and autosync stay output-free.
//
// The bundle's `outputs` reuse the exact same capped projection as the local
// overlay (`projectNotebookOverlay`), so per-item / per-cell / notebook byte caps
// and the `OutputTooLarge` placeholder behave identically to what was persisted.

import type { NotebookJSON } from './schema'
import type { OutputItem } from '../runtime/types'
import {
  projectNotebookOverlay,
  type OverlayOverflow,
  type PersistedCellOutput,
} from './outputOverlay'

/** Bumped when the bundle shape changes; import (Step 7) gates on it. */
export const EXPORT_BUNDLE_VERSION = 1

/**
 * A self-contained, re-importable notebook export: the wire-safe `NotebookJSON`
 * plus its rich cell outputs as a separate, capped projection. Never equal to
 * `NotebookJSON` (which has no `outputs`), so it can never be mistaken for — or
 * fed straight back into — the autosync payload.
 */
export interface NotebookExportBundle {
  exportVersion: number
  notebook: NotebookJSON
  outputs: PersistedCellOutput[]
  /**
   * The bounded notebook-wide overflow marker (C6.4/C7): non-null when the 32 MiB
   * cap forced later cells to be dropped, carrying only the dropped COUNT. Mirrors
   * the local overlay so the diagnostic is never silently lost on export.
   */
  overflow: OverlayOverflow | null
}

/**
 * Build the export bundle from a notebook snapshot and the live per-cell outputs.
 * Outputs go through `projectNotebookOverlay`, so they carry the same caps,
 * `OutputTooLarge` markers, AND the notebook-wide `overflow` marker as the
 * persisted overlay; cells with no persistable output are omitted.
 */
export function toExportBundle(input: {
  notebook: NotebookJSON
  savedAt: number
  cells: ReadonlyArray<{ cellId: string; sourceUpdatedAt: number; items: readonly OutputItem[] }>
}): NotebookExportBundle {
  const overlay = projectNotebookOverlay({
    notebookId: input.notebook.id,
    savedAt: input.savedAt,
    cells: input.cells,
  })
  return {
    exportVersion: EXPORT_BUNDLE_VERSION,
    notebook: input.notebook,
    outputs: overlay.cells,
    overflow: overlay.overflow,
  }
}
