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
  metadata: Record<string, never>
  source: string[]
}

interface JupyterCodeCell {
  cell_type: 'code'
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

/** Decode a base64 payload to a UTF-8 string (for `image/svg+xml`, stored as text). */
function base64ToUtf8(data: string): string {
  const binary = atob(data)
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
  return new TextDecoder().decode(bytes)
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
    case 'image':
      // SVG is stored as text in nbformat; raster mimes carry the raw base64.
      return {
        output_type: 'display_data',
        data: {
          [item.mime]: item.mime === 'image/svg+xml' ? base64ToUtf8(item.data) : item.data,
        },
        metadata: {},
      }
    case 'html':
      // Live here — Jupyter renders `text/html` through its own sandbox/sanitizer,
      // unlike a plain Markdown file (where we fence HTML inert). See contract §3.
      return {
        output_type: 'display_data',
        data: { 'text/html': item.html },
        metadata: {},
      }
  }
}

function cellToJupyter(cell: CellJSON, outputs: readonly PersistedOutputItem[]): JupyterCell {
  if (cell.kind === 'markdown') {
    return { cell_type: 'markdown', metadata: {}, source: toSourceLines(cell.content) }
  }
  return {
    cell_type: 'code',
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
