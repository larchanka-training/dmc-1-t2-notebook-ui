// Pure conversion between the in-memory cell model and the persistent
// NotebookJSON shape. No side effects, no storage access — just data mapping,
// so it is trivially unit-testable and reusable by both the local store and
// the future sync layer.
//
// The one rename that lives here: domain `code` ⇄ persisted `content`. Run
// state (output, status, executionCount) is not serialized; cells restored
// from JSON start unrun.

import { reatomCell, type Cell } from '../domain/cell'
import { FORMAT_VERSION, type CellJSON, type NotebookJSON } from './schema'

/** Metadata that lives on the notebook, not on individual cells. */
export interface NotebookMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

function cellToJSON(cell: Cell): CellJSON {
  return {
    id: cell.id,
    kind: cell.kind,
    content: cell.code(),
    updatedAt: cell.updatedAt(),
  }
}

/** Snapshot the current cell list + notebook metadata into a NotebookJSON. */
export function toJSON(cells: Cell[], meta: NotebookMeta): NotebookJSON {
  return {
    formatVersion: FORMAT_VERSION,
    id: meta.id,
    title: meta.title,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    cells: cells.map(cellToJSON),
  }
}

/** Rebuild live cells from a NotebookJSON. Run state starts empty. */
export function fromJSON(json: NotebookJSON): Cell[] {
  return json.cells.map((cell) => reatomCell(cell.content, cell.kind, cell.id, cell.updatedAt))
}

const DEFAULT_TITLE = 'Untitled notebook'

// Code cells are always JavaScript in this notebook engine — there is no
// per-cell language. Fence with the language hint so downstream Markdown
// renderers (GitHub, VS Code) syntax-highlight automatically.
const CODE_FENCE_LANG = 'javascript'

function codeCellToMarkdown(content: string): string {
  // Strip a single trailing newline so the closing fence is not preceded by a
  // blank line; the join('\n\n') below already separates cells.
  const trimmed = content.endsWith('\n') ? content.slice(0, -1) : content
  return '```' + CODE_FENCE_LANG + '\n' + trimmed + '\n```'
}

/**
 * Convert a NotebookJSON snapshot into a human-readable Markdown document.
 *
 * - Title becomes the first H1 (`# <title>`).
 * - Markdown cells are emitted as-is (GFM passthrough).
 * - Code cells are wrapped in a fenced block with a `javascript` language hint.
 * - Cells are separated by a single blank line; the document ends with a
 *   trailing newline so POSIX tools treat it as a well-formed text file.
 *
 * Known limitation: a markdown cell containing a literal ``` fence is emitted
 * verbatim — it can confuse downstream parsers but is not corrupted (round-trip
 * is via JSON export, not Markdown re-parse).
 */
export function toMarkdown(json: NotebookJSON): string {
  const parts: string[] = [`# ${json.title || DEFAULT_TITLE}`]
  for (const cell of json.cells) {
    parts.push(cell.kind === 'markdown' ? cell.content : codeCellToMarkdown(cell.content))
  }
  return parts.join('\n\n') + '\n'
}
