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
//   - Caps are enforced on the ACTUAL serialized representation that gets
//     stored — `JSON.stringify(cell.items)` and `JSON.stringify(overlay)` — so
//     array delimiters, the object envelope, and the overflow marker are all
//     counted (C2/C6.4). Accounting is analytical (O(n)) but exact for JSON.
//   - Over-cap items are replaced by a stable `OutputTooLarge` placeholder
//     (C6.4: reuse the `error` item, `name: 'OutputTooLarge'`), which renders
//     through the existing OutputView with no new render path.

import type { OutputItem } from '../runtime/types'

/** The output item types that are persisted (rich outputs only). */
export type PersistableOutputItem = Extract<OutputItem, { type: 'result' | 'html' | 'image' }>

/** `error.name` that marks an `error` item as an `OutputTooLarge` placeholder. */
export const OUTPUT_TOO_LARGE_NAME = 'OutputTooLarge'

/**
 * The synthetic "output too large to save" placeholder. A narrowed subtype of
 * the runtime `error` item (assignable to `OutputItem`, so it renders as an
 * error note on reopen) whose literal `name` distinguishes it — real runtime
 * errors are never persisted, so a persisted `error` is always this marker.
 */
export interface OutputTooLargeItem {
  type: 'error'
  name: typeof OUTPUT_TOO_LARGE_NAME
  message: string
}

/** A persisted output item: a rich output or an `OutputTooLarge` placeholder. */
export type PersistedOutputItem = PersistableOutputItem | OutputTooLargeItem

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

/**
 * The single, bounded notebook-level overflow marker (C6.4): when the
 * notebook-wide cap is reached, later cells are omitted (oldest-first retained)
 * and only their COUNT is recorded — never a variable-length id list, which
 * would itself be unaccounted metadata.
 */
export interface OverlayOverflow {
  droppedCellCount: number
}

/** A notebook's local output overlay — a separate store from `NotebookJSON`. */
export interface NotebookOutputOverlay {
  notebookId: string
  savedAt: number
  cells: PersistedCellOutput[]
  /** `null` when everything fit; otherwise the bounded overflow marker. */
  overflow: OverlayOverflow | null
}

// ─── Caps (exact bytes) — graphical-output-contract.md §6 C2/C6.4 ────────────
/** Per-`html`-item cap: UTF-8 bytes of the markup. */
export const HTML_MAX_BYTES = 256 * 1024
/** Per-`image`-item cap: length of the stored base64 payload. */
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024
/** Per-cell cap over `JSON.stringify(cell.items)`. */
export const CELL_MAX_BYTES = 4 * 1024 * 1024
/** Notebook-wide cap over `JSON.stringify(overlay)` (exact, C6.4). */
export const NOTEBOOK_MAX_BYTES = 32 * 1024 * 1024

const encoder = new TextEncoder()

/** UTF-8 byte length (honest about multibyte chars, not UTF-16 units). */
function utf8Bytes(text: string): number {
  return encoder.encode(text).length
}

/** Bytes of a value's JSON serialization. */
function jsonBytes(value: unknown): number {
  return utf8Bytes(JSON.stringify(value))
}

/**
 * Exact byte length of `JSON.stringify(items)` for an array with `count`
 * elements whose serialized sizes sum to `sum`: `[` + e0 + `,` + … + `]`. No
 * whitespace in `JSON.stringify`, so this equals the real serialized length.
 * Taking totals (not the array) keeps the overflow loops O(n) — no per-step
 * copies of the growing prefix.
 */
function arrayBytesOf(sum: number, count: number): number {
  if (count === 0) return 2 // "[]"
  return 2 + sum + (count - 1) // brackets + elements + commas
}

/** Sum of the element sizes → {@link arrayBytesOf}. */
function arrayBytes(elementBytes: readonly number[]): number {
  let sum = 0
  for (const b of elementBytes) sum += b
  return arrayBytesOf(sum, elementBytes.length)
}

function tooLarge(message: string): OutputTooLargeItem {
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
 * Project one cell's live run output into its bounded persisted form. The result
 * satisfies `JSON.stringify(items).length ≤ CELL_MAX_BYTES` (bytes), reserving
 * the truncation marker's own serialized size before it is appended.
 */
export function projectCellOutputs(input: {
  cellId: string
  sourceUpdatedAt: number
  savedAt: number
  items: readonly OutputItem[]
}): PersistedCellOutput {
  const capped = input.items.filter(isPersistable).map(capItem)
  const sizes = capped.map(jsonBytes)

  let items: PersistedOutputItem[]
  if (arrayBytes(sizes) <= CELL_MAX_BYTES) {
    items = capped // everything fits, no marker
  } else {
    // Overflow: keep the longest oldest-first prefix that fits WITH the marker
    // appended, so the final `[...kept, marker]` array stays within the cap.
    const marker = tooLarge(`Cell output truncated: exceeds ${CELL_MAX_BYTES} bytes`)
    const markerBytes = jsonBytes(marker)
    const kept: PersistedOutputItem[] = []
    let keptSum = 0
    for (let i = 0; i < capped.length; i++) {
      // Final array would be [...kept, item, marker] → kept.length + 2 elements.
      if (arrayBytesOf(keptSum + sizes[i]! + markerBytes, kept.length + 2) > CELL_MAX_BYTES) break
      kept.push(capped[i]!)
      keptSum += sizes[i]!
    }
    kept.push(marker)
    items = kept
  }

  return {
    cellId: input.cellId,
    sourceUpdatedAt: input.sourceUpdatedAt,
    savedAt: input.savedAt,
    items,
  }
}

/** Bytes of `JSON.stringify(overlay)` given the serialized cell-record sizes. */
function overlayBytes(
  notebookId: string,
  savedAt: number,
  cellRecordSizes: readonly number[],
  overflow: OverlayOverflow | null,
): number {
  // The envelope with an empty cells array, then swap the empty-array bytes for
  // the real array bytes (only `cells` varies; key order is fixed by the literal
  // returned below, so this is exact).
  const skeleton = jsonBytes({ notebookId, savedAt, cells: [], overflow })
  return skeleton - 2 + arrayBytes(cellRecordSizes)
}

/**
 * Project a whole notebook's per-cell outputs into the overlay, enforcing the
 * notebook-wide cap on the ACTUAL `JSON.stringify(overlay)` size (envelope +
 * bounded overflow marker included). Cells are taken in order; once a cell would
 * push the serialized overlay past {@link NOTEBOOK_MAX_BYTES}, it and all later
 * cells are omitted and counted in a single {@link OverlayOverflow} marker
 * (oldest-first retained, C6.4). Cells that project to no items are skipped.
 */
export function projectNotebookOverlay(input: {
  notebookId: string
  savedAt: number
  cells: ReadonlyArray<{ cellId: string; sourceUpdatedAt: number; items: readonly OutputItem[] }>
}): NotebookOutputOverlay {
  const { notebookId, savedAt } = input

  const projected = input.cells
    .map((cell) =>
      projectCellOutputs({
        cellId: cell.cellId,
        sourceUpdatedAt: cell.sourceUpdatedAt,
        savedAt,
        items: cell.items,
      }),
    )
    .filter((cell) => cell.items.length > 0)
  const sizes = projected.map(jsonBytes)

  // Fast path: all non-empty cells fit with no overflow marker.
  if (overlayBytes(notebookId, savedAt, sizes, null) <= NOTEBOOK_MAX_BYTES) {
    return { notebookId, savedAt, cells: projected, overflow: null }
  }

  // Overflow: reserve the marker (use the max possible dropped count so the
  // envelope estimate is an upper bound on the real one). The envelope skeleton is
  // fixed across the loop, so hoist it and track a running cell-size sum → O(n).
  const reserve: OverlayOverflow = { droppedCellCount: projected.length }
  const skeleton = jsonBytes({ notebookId, savedAt, cells: [], overflow: reserve })
  const kept: PersistedCellOutput[] = []
  let keptSum = 0
  for (let i = 0; i < projected.length; i++) {
    const cellsArrayBytes = arrayBytesOf(keptSum + sizes[i]!, kept.length + 1)
    if (skeleton - 2 + cellsArrayBytes > NOTEBOOK_MAX_BYTES) break
    kept.push(projected[i]!)
    keptSum += sizes[i]!
  }

  const droppedCellCount = projected.length - kept.length
  return {
    notebookId,
    savedAt,
    cells: kept,
    overflow: droppedCellCount > 0 ? { droppedCellCount } : null,
  }
}

/** True when the item is an `OutputTooLarge` placeholder (not a real error). */
export function isOutputTooLarge(item: OutputItem): item is OutputTooLargeItem {
  return item.type === 'error' && item.name === OUTPUT_TOO_LARGE_NAME
}
