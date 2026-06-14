import type { LlmContextCell } from '@/shared/api'
import type { Cell } from '../../domain/cell'
import type { OutputItem, SerializedValue } from '../../runtime/types'
import { buildGlobalsDigest } from './globalsDigest'

// Context Builder (Epic 07 / #116). Assembles the notebook context that feeds an
// LLM generation request: previous cells (code / markdown source), a compact
// globals digest (name/type/shape), and truncated cell outputs — all as the
// shared `{ kind, source }` wire shape (docs/ai-architecture.md §4.3).

/** Last N cells above the prompt cell kept verbatim (§4.3 window). */
export const DEFAULT_CONTEXT_WINDOW = 10
/** Generation context byte budget; mirrors the backend `llm_max_prompt_bytes`. */
export const CONTEXT_BYTE_CAP = 8192
/** The generation endpoint accepts at most this many context items. */
export const MAX_CONTEXT_ITEMS = 10
/** Per-cell output digest cap, so a chatty output never dominates the budget. */
export const MAX_OUTPUT_DIGEST_BYTES = 512
/**
 * Per-item source cap (UTF-8 bytes). Mirrors the backend `LlmContextCell.source`
 * `maxLength: 8000` (chars) / `MAX_CONTEXT_SOURCE_LENGTH`: capping bytes ≤ 8000
 * guarantees the char limit too (char count ≤ byte count), so a single long item
 * (a big cell, or a long globals digest) never trips a 422 downstream.
 */
export const CONTEXT_ITEM_SOURCE_CAP = 8000

export interface ContextBuilderOptions {
  /** Build context from the cells strictly *above* this one (the prompt cell). */
  beforeCellId?: string
  /** How many newest previous cells to keep verbatim. */
  windowSize?: number
  /** Total UTF-8 byte budget for the assembled context. */
  byteCap?: number
  /** Hard ceiling on the number of context items (the globals item is kept). */
  maxItems?: number
  /** Include a truncated digest of each cell's outputs. */
  includeOutputs?: boolean
  /** Include the static globals digest. */
  includeGlobals?: boolean
}

const encoder = new TextEncoder()

export function utf8Length(text: string): number {
  return encoder.encode(text).length
}

/**
 * Truncate `text` so its UTF-8 encoding fits `maxBytes`, never exceeding the cap.
 *
 * Slicing the byte array blindly can split a multi-byte codepoint, and the
 * resulting replacement char (`�`, 3 bytes) can make the string *longer* than
 * the cap. Instead, binary-search the largest char-prefix that fits, then drop a
 * trailing lone surrogate so no replacement char is introduced.
 */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (utf8Length(text) <= maxBytes) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (utf8Length(text.slice(0, mid)) <= maxBytes) lo = mid
    else hi = mid - 1
  }
  let result = text.slice(0, lo)
  // A trailing high surrogate would be a lone half (→ replacement char); drop it.
  const last = result.charCodeAt(result.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) result = result.slice(0, -1)
  return result
}

function serializedValueLabel(value: SerializedValue): string {
  switch (value.kind) {
    case 'primitive':
      return value.value === null ? 'null' : String(value.value)
    case 'undefined':
      return 'undefined'
    case 'array':
      return `array[${value.items.length}]`
    case 'object':
      return `object{${value.entries.map(([k]) => k).join(',')}}`
    case 'function':
      return `function ${value.name}`.trim()
    case 'truncated':
      return value.placeholder
  }
}

/** Render a cell's outputs into one compact, human-readable digest line. */
export function outputsDigest(outputs: OutputItem[]): string {
  const parts = outputs.map((item) => {
    switch (item.type) {
      case 'stdout':
        return item.text
      case 'stderr':
        return `[stderr] ${item.text}`
      case 'error':
        // `error.hint` (e.g. "Promise rejected; did you forget await?") is a
        // UI-only affordance and is intentionally omitted from the LLM digest —
        // name + message carry the error. Surfacing it to the model is a
        // deferred follow-up, not part of TARDIS-65.
        return `[error] ${item.name}: ${item.message}`
      case 'result':
        return `[result] ${serializedValueLabel(item.value)}`
      case 'html':
        return '[html output]'
      case 'image':
        return `[image ${item.mime}]`
    }
  })
  return parts.join('\n').trim()
}

function cellKindToContextKind(cell: Cell): 'code' | 'markdown' {
  return cell.kind === 'markdown' ? 'markdown' : 'code'
}

/**
 * Context items contributed by a single cell: its verbatim source (when
 * non-empty) plus, optionally, a truncated digest of its outputs. Exposed so the
 * persisted-mode sync can recompute one cell's contribution incrementally.
 */
export function cellToContextItems(
  cell: Cell,
  options: { includeOutputs?: boolean } = {},
): LlmContextCell[] {
  const { includeOutputs = true } = options
  const items: LlmContextCell[] = []
  const source = cell.code()
  if (source.trim()) items.push({ kind: cellKindToContextKind(cell), source })
  if (includeOutputs) {
    const digest = outputsDigest(cell.output())
    if (digest)
      items.push({ kind: 'output', source: truncateUtf8(digest, MAX_OUTPUT_DIGEST_BYTES) })
  }
  return items
}

/**
 * Drop items until the context fits both the byte budget and the item ceiling.
 * The globals digest is preserved (it summarises the whole scope); the oldest
 * verbatim cells are trimmed first, matching §4.3 "truncate from the oldest".
 */
export function capContextItems(
  items: LlmContextCell[],
  byteCap: number,
  maxItems: number,
): LlmContextCell[] {
  // First, cap each item to the per-item source limit (≤ min(byteCap, 8000)) so a
  // single long item never violates the backend `source maxLength: 8000`, then
  // trim the whole list to the total budget.
  const perItemCap = Math.min(byteCap, CONTEXT_ITEM_SOURCE_CAP)
  const result = items.map((item) =>
    utf8Length(item.source) > perItemCap
      ? { ...item, source: truncateUtf8(item.source, perItemCap) }
      : item,
  )

  const dropOldestNonGlobals = (): boolean => {
    const idx = result.findIndex((item) => item.kind !== 'globals')
    if (idx === -1) return false
    result.splice(idx, 1)
    return true
  }

  while (result.length > maxItems && dropOldestNonGlobals()) {
    /* shrink to the item ceiling */
  }

  let total = result.reduce((sum, item) => sum + utf8Length(item.source), 0)
  while (total > byteCap && result.length > 1 && dropOldestNonGlobals()) {
    total = result.reduce((sum, item) => sum + utf8Length(item.source), 0)
  }

  if (result.length === 1 && utf8Length(result[0].source) > byteCap) {
    result[0] = { ...result[0], source: truncateUtf8(result[0].source, byteCap) }
  }
  return result
}

/**
 * Build the ordered (old → new) context block for the cells preceding the
 * prompt cell. The returned array is ready to send as the `/llm/generate`
 * `context`, and is budget- and slot-capped so the backend accepts it directly
 * (Mode A). For persisted Mode B, pass a larger `windowSize`/`byteCap`/`maxItems`
 * and let the backend roll it up.
 */
export function buildNotebookContext(
  cells: Cell[],
  options: ContextBuilderOptions = {},
): LlmContextCell[] {
  const {
    beforeCellId,
    windowSize = DEFAULT_CONTEXT_WINDOW,
    byteCap = CONTEXT_BYTE_CAP,
    maxItems = MAX_CONTEXT_ITEMS,
    includeOutputs = true,
    includeGlobals = true,
  } = options

  let previous = cells
  if (beforeCellId !== undefined) {
    const idx = cells.findIndex((cell) => cell.id === beforeCellId)
    previous = idx === -1 ? cells : cells.slice(0, idx)
  }

  const items: LlmContextCell[] = []

  // Globals digest is computed from ALL previous code cells (the whole scope),
  // not just the window, and sits first as the scope overview.
  if (includeGlobals) {
    const digest = buildGlobalsDigest(previous)
    if (digest) items.push({ kind: 'globals', source: truncateUtf8(digest, byteCap) })
  }

  for (const cell of previous.slice(-windowSize)) {
    items.push(...cellToContextItems(cell, { includeOutputs }))
  }

  return capContextItems(items, byteCap, maxItems)
}

/** Render assembled context items into the prompt text block (in-browser path). */
export function contextToPromptBlock(items: LlmContextCell[]): string {
  if (items.length === 0) return ''
  const blocks = items.map((item) => `// [${item.kind}]\n${item.source}`)
  return `Notebook context:\n${blocks.join('\n\n')}`
}
