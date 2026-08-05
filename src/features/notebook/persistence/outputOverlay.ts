// Local-only persisted projection of cell outputs — the pure core of the
// graphical-output overlay (roadmap Step 6, graphical-output-contract.md §6
// C1/C2/C6). This module is deliberately storage- and lifecycle-free: it only
// turns live run outputs into the bounded, serializable shape that a later slice
// writes to a separate IndexedDB store. It NEVER touches `NotebookJSON` — that
// type doubles as the autosync wire contract (schema.ts), so rich outputs are
// kept out of it and off the sync path.
//
// Contract highlights (see §6):
//   - Only the rich, not-cheaply-re-viewable outputs persist: `result`, `html`,
//     `image`. Streams (`stdout`/`stderr`) and live runtime `error`s do not.
//   - Byte-accurate caps, measured on the actually-serialized representation.
//   - Over-cap items are replaced by a stable `OutputTooLarge` placeholder
//     (C6.4: reuse the existing `error` item, `name: 'OutputTooLarge'`), which
//     renders through the existing OutputView with no new render path.

import type { OutputItem } from '../runtime/types'

/** The output item types that are persisted (rich outputs only). */
export type PersistableOutputItem = Extract<OutputItem, { type: 'result' | 'html' | 'image' }>

/**
 * A persisted output item: either a rich output or an `OutputTooLarge`
 * placeholder. The placeholder reuses the runtime `error` item (C6.4) so it is
 * structurally part of the shared `OutputItem` union and renders as an error
 * note on reopen; `name === OUTPUT_TOO_LARGE_NAME` distinguishes it from a real
 * runtime error (real errors are not persisted).
 */
export type PersistedOutputItem = PersistableOutputItem | Extract<OutputItem, { type: 'error' }>

/** One cell's persisted outputs, version-stamped to the source it belongs to. */
export interface PersistedCellOutput {
  cellId: string
  /**
   * The cell's content version (`updatedAt`) captured at EXECUTION START (C6.2),
   * so a source edit made during the run cannot bind this result to the newer
   * version. On restore, outputs are used only when this still matches the
   * cell's current `updatedAt`.
   */
  sourceUpdatedAt: number
  /** When this projection was produced, Unix epoch ms. */
  savedAt: number
  items: PersistedOutputItem[]
}

/** A notebook's local output overlay — a separate store from `NotebookJSON`. */
export interface NotebookOutputOverlay {
  notebookId: string
  savedAt: number
  cells: PersistedCellOutput[]
  /**
   * Cell ids whose outputs were omitted because the notebook-wide cap was
   * reached (oldest-first retained). Empty when nothing was dropped. Recorded
   * rather than silently dropped so the UI/export can explain the gap (C6.4).
   */
  droppedCellIds: string[]
}

// ─── Caps (exact bytes) — graphical-output-contract.md §6 C2/C6.4 ────────────
/** Per-`html`-item cap: UTF-8 bytes of the markup. */
export const HTML_MAX_BYTES = 256 * 1024
/** Per-`image`-item cap: length of the stored base64 payload. */
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024
/** Per-cell cap over the serialized persisted items. */
export const CELL_MAX_BYTES = 4 * 1024 * 1024
/** Notebook-wide cap over the serialized overlay (exact, C6.4). */
export const NOTEBOOK_MAX_BYTES = 32 * 1024 * 1024

/** `error.name` that marks an `error` item as an `OutputTooLarge` placeholder. */
export const OUTPUT_TOO_LARGE_NAME = 'OutputTooLarge'

const encoder = new TextEncoder()

/** UTF-8 byte length (honest about multibyte chars, not UTF-16 units). */
function utf8Bytes(text: string): number {
  return encoder.encode(text).length
}

/** Bytes of an item's serialized (persisted) representation. */
function serializedBytes(item: PersistedOutputItem): number {
  return utf8Bytes(JSON.stringify(item))
}

function tooLarge(message: string): Extract<OutputItem, { type: 'error' }> {
  return { type: 'error', name: OUTPUT_TOO_LARGE_NAME, message }
}

/** True for the rich output types that are persisted. */
function isPersistable(item: OutputItem): item is PersistableOutputItem {
  return item.type === 'result' || item.type === 'html' || item.type === 'image'
}

/**
 * Apply the per-item byte cap, replacing an over-cap `html`/`image` with an
 * `OutputTooLarge` placeholder. `result` has no per-type cap (the per-cell cap
 * governs it).
 */
function capItem(item: PersistableOutputItem): PersistedOutputItem {
  if (item.type === 'html') {
    const bytes = utf8Bytes(item.html)
    if (bytes > HTML_MAX_BYTES) {
      return tooLarge(`HTML output not saved: ${bytes} bytes exceeds ${HTML_MAX_BYTES}`)
    }
  } else if (item.type === 'image') {
    const bytes = utf8Bytes(item.data)
    if (bytes > IMAGE_MAX_BYTES) {
      return tooLarge(`Image output not saved: ${bytes} bytes exceeds ${IMAGE_MAX_BYTES}`)
    }
  }
  return item
}

/**
 * Project one cell's live run output into its bounded persisted form.
 *
 * Order (deterministic, oldest-first retained):
 *   1. keep only rich outputs (`result`/`html`/`image`);
 *   2. per-item cap → placeholder for over-cap `html`/`image`;
 *   3. per-cell cap: accumulate serialized bytes; when the next item would
 *      exceed {@link CELL_MAX_BYTES}, stop and append ONE cell-level placeholder.
 */
export function projectCellOutputs(input: {
  cellId: string
  sourceUpdatedAt: number
  savedAt: number
  items: readonly OutputItem[]
}): PersistedCellOutput {
  const capped = input.items.filter(isPersistable).map(capItem)

  const kept: PersistedOutputItem[] = []
  let total = 0
  let overflowed = false
  for (const item of capped) {
    const bytes = serializedBytes(item)
    if (total + bytes > CELL_MAX_BYTES) {
      overflowed = true
      break
    }
    kept.push(item)
    total += bytes
  }
  if (overflowed) {
    kept.push(tooLarge(`Cell output truncated: exceeds ${CELL_MAX_BYTES} bytes`))
  }

  return {
    cellId: input.cellId,
    sourceUpdatedAt: input.sourceUpdatedAt,
    savedAt: input.savedAt,
    items: kept,
  }
}

/**
 * Project a whole notebook's per-cell outputs into the overlay, enforcing the
 * notebook-wide cap. Cells are taken in order; once a cell's serialized size
 * would push the running total past {@link NOTEBOOK_MAX_BYTES}, that cell and
 * all later cells are omitted and their ids recorded in `droppedCellIds`
 * (oldest-first retained, C6.4). Cells that project to no items are skipped
 * entirely (nothing to persist).
 */
export function projectNotebookOverlay(input: {
  notebookId: string
  savedAt: number
  cells: ReadonlyArray<{ cellId: string; sourceUpdatedAt: number; items: readonly OutputItem[] }>
}): NotebookOutputOverlay {
  const cells: PersistedCellOutput[] = []
  const droppedCellIds: string[] = []
  let total = 0
  let capReached = false

  for (const cell of input.cells) {
    const projected = projectCellOutputs({
      cellId: cell.cellId,
      sourceUpdatedAt: cell.sourceUpdatedAt,
      savedAt: input.savedAt,
      items: cell.items,
    })
    if (projected.items.length === 0) continue

    if (capReached) {
      droppedCellIds.push(cell.cellId)
      continue
    }

    const bytes = utf8Bytes(JSON.stringify(projected))
    if (total + bytes > NOTEBOOK_MAX_BYTES) {
      capReached = true
      droppedCellIds.push(cell.cellId)
      continue
    }
    cells.push(projected)
    total += bytes
  }

  return { notebookId: input.notebookId, savedAt: input.savedAt, cells, droppedCellIds }
}

/** True when the item is an `OutputTooLarge` placeholder (not a real error). */
export function isOutputTooLarge(item: OutputItem): boolean {
  return item.type === 'error' && item.name === OUTPUT_TOO_LARGE_NAME
}
