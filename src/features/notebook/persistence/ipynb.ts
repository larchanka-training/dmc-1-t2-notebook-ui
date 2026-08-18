// Jupyter Notebook (.ipynb, nbformat v4.5) export — the third export format after
// JSON and Markdown (roadmap Step 7; see docs/specs/export-completion-contract.md).
//
// This is a PURE mapping from the already-built `NotebookExportBundle` (the same
// capped, version-matched projection JSON and Markdown use) into an nbformat
// document. It writes NO new caps/overflow/freshness logic — those already ran when
// the bundle was assembled — so all three formats stay in lock-step.
//
// Frontend-only, by decision: `.ipynb` is plain JSON the client can produce, and a
// client generator preserves the offline / signed-out self-export guarantee that a
// backend route could not.

import { formatSerializedValue } from './serialize'
import { isOutputTooLarge, type PersistedOutputItem } from './outputOverlay'
import type { NotebookExportBundle } from './exportBundle'
import type { CellJSON } from './schema'

// ─── nbformat v4.5 shapes (minimal, only what we emit) ───────────────────────

/** nbformat mime-bundle: mime type → payload (string form is valid multiline). */
type MimeBundle = Record<string, string>

type JupyterOutput =
  | {
      output_type: 'execute_result'
      execution_count: number | null
      data: MimeBundle
      metadata: Record<string, never>
    }
  | { output_type: 'display_data'; data: MimeBundle; metadata: Record<string, never> }
  | { output_type: 'stream'; name: 'stdout' | 'stderr'; text: string }

interface JupyterMarkdownCell {
  cell_type: 'markdown'
  id: string
  metadata: Record<string, never>
  source: string[]
}

interface JupyterCodeCell {
  cell_type: 'code'
  id: string
  metadata: Record<string, never>
  execution_count: number | null
  source: string[]
  outputs: JupyterOutput[]
}

type JupyterCell = JupyterMarkdownCell | JupyterCodeCell

export interface JupyterNotebook {
  nbformat: 4
  nbformat_minor: 5
  metadata: {
    kernelspec: { name: string; display_name: string }
    language_info: { name: string }
  }
  cells: JupyterCell[]
}

// ─── Mapping ─────────────────────────────────────────────────────────────────

// nbformat 4.5 requires a cell `id` on every cell. The synthetic overflow-notice
// cell needs a fixed, schema-valid id (`^[a-zA-Z0-9-_]+$`, ≤ 64 chars) that cannot
// collide with a real cell id — notebook cell ids are UUIDs (hex + dashes only), so
// this literal (contains non-hex letters) is guaranteed distinct.
const OVERFLOW_CELL_ID = 'jsnb-output-overflow'

/**
 * Split cell/text content into nbformat `source` lines: each line keeps its
 * trailing `\n` except the last, and empty content is an empty array — the
 * canonical Jupyter representation.
 */
function toSourceLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  return lines.map((line, i) => (i < lines.length - 1 ? line + '\n' : line))
}

/**
 * Decode a base64 payload to a UTF-8 string (for `image/svg+xml`, stored as text),
 * or `null` if the payload is not valid base64. Persisted-output validation checks
 * the data type and size but NOT base64 validity, so a malformed SVG can reach here;
 * returning `null` lets the caller degrade one item instead of throwing and aborting
 * the whole export.
 */
function tryBase64ToUtf8(data: string): string | null {
  try {
    const binary = atob(data)
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

/** Map one persisted output item to its nbformat output (C3 / export contract §3). */
function outputItemToJupyter(item: PersistedOutputItem): JupyterOutput {
  // The only persisted `error` item is the OutputTooLarge placeholder → a visible
  // stderr stream; never fabricate output data for it.
  if (isOutputTooLarge(item)) {
    return { output_type: 'stream', name: 'stderr', text: item.message }
  }
  switch (item.type) {
    case 'result':
      return {
        output_type: 'execute_result',
        execution_count: null,
        data: { 'text/plain': formatSerializedValue(item.value) },
        metadata: {},
      }
    case 'image': {
      if (item.mime === 'image/svg+xml') {
        // SVG is stored as text in nbformat, so it must be decoded. A malformed
        // payload degrades to a visible note — one bad item must not abort export.
        const svg = tryBase64ToUtf8(item.data)
        if (svg === null) {
          return {
            output_type: 'stream',
            name: 'stderr',
            text: 'SVG image output not exportable: invalid base64 data.',
          }
        }
        return { output_type: 'display_data', data: { 'image/svg+xml': svg }, metadata: {} }
      }
      // Raster mimes carry the raw base64 (Jupyter expects base64 for image/png etc.).
      return { output_type: 'display_data', data: { [item.mime]: item.data }, metadata: {} }
    }
    case 'html':
      // Emitted as real `text/html` (not fenced inert like the Markdown export),
      // because Jupyter has a trust model a plain Markdown file does not: a freshly
      // opened notebook is UNTRUSTED, so its stored HTML is sanitised and active
      // content (scripts) is blocked. Note this is a trust decision, not a
      // guarantee — once the user runs "Trust Notebook" (or re-executes the cell),
      // active content in this output CAN render. See contract §3.
      return {
        output_type: 'display_data',
        data: { 'text/html': item.html },
        metadata: {},
      }
  }
}

function cellToJupyter(cell: CellJSON, outputs: readonly PersistedOutputItem[]): JupyterCell {
  if (cell.kind === 'markdown') {
    return { cell_type: 'markdown', id: cell.id, metadata: {}, source: toSourceLines(cell.content) }
  }
  return {
    cell_type: 'code',
    id: cell.id,
    metadata: {},
    execution_count: null,
    source: toSourceLines(cell.content),
    outputs: outputs.map(outputItemToJupyter),
  }
}

/**
 * Build a Jupyter (.ipynb) document from the export bundle. Outputs come from the
 * bundle (version-matched + capped); the notebook-wide `overflow` marker becomes a
 * trailing markdown cell so a size-cap omission is never silently lost.
 */
export function toIpynb(bundle: NotebookExportBundle): JupyterNotebook {
  const outputsByCellId = new Map(bundle.outputs.map((cell) => [cell.cellId, cell.items]))
  const cells: JupyterCell[] = bundle.notebook.cells.map((cell) =>
    cellToJupyter(cell, outputsByCellId.get(cell.id) ?? []),
  )
  if (bundle.overflow) {
    const n = bundle.overflow.droppedCellCount
    cells.push({
      cell_type: 'markdown',
      id: OVERFLOW_CELL_ID,
      metadata: {},
      source: [
        `> ⚠️ ${n} cell output${n === 1 ? '' : 's'} omitted: notebook output size limit reached.`,
      ],
    })
  }
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { name: 'javascript', display_name: 'JavaScript' },
      language_info: { name: 'javascript' },
    },
    cells,
  }
}
