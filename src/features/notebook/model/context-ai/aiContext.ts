import { action, atom, wrap } from '@reatom/core'
import { aiContext, type AiContext, type LlmContextCell } from '@/shared/api'
import type { Cell } from '../../domain/cell'
import { cellsAtom } from '../notebook'
import { notebookRevisionAtom } from '../revision'
import {
  CONTEXT_BYTE_CAP,
  MAX_CONTEXT_ITEMS,
  MAX_OUTPUT_DIGEST_BYTES,
  capContextItems,
  cellToContextItems,
  outputsDigest,
  truncateUtf8,
} from './contextBuilder'
import { extractDeclarations, formatGlobalsDigest, mergeDeclarations } from './globalsDigest'

// Mode B orchestration: a per-cell working model is maintained INCREMENTALLY
// (only the cells a change touched are recomputed) and persisted to the backend
// as a remote store/sync (Epic 07 / #116, docs/context-ai-workflow.md).
//
// Role of the pieces:
// - The local working model (per-cell `contributions`) is the SINGLE source for
//   the context that goes to the model. Generation reads it cell-aware (cells
//   above the prompt cell) and re-reads outputs live, so it matches the at-send
//   rule (§4.3) and never sends stale outputs or "future" cells.
// - The backend (load on entry + debounced PUTs) is a remote store/sync of the
//   rolled-up history. It does NOT drive generation directly; we do not overwrite
//   the loaded server state with an immediate rebuild on entry.
//
// Outputs are NOT cached (they change without bumping the notebook revision, so a
// cache would go stale); they are read live at generation time instead. The store
// PUT therefore carries cell source + globals only.

// Debounce window for persisting edits — like autosave, a burst of keystrokes
// coalesces into one PUT instead of one-per-keystroke.
const PERSIST_DEBOUNCE_MS = 400

/** One cell's cached contribution: its source item (no outputs) + declared globals. */
interface CellContribution {
  items: LlmContextCell[]
  globals: string[]
}

/** The last context loaded from / persisted to the backend (remote store/sync). */
export const persistedContextAtom = atom<AiContext | null>(null, 'notebook.aiContext.persisted')

/** True when the last load from the backend failed (logged; generation is local). */
export const contextLoadFailedAtom = atom(false, 'notebook.aiContext.loadFailed')

// Per-cell contribution cache; the source of truth for incremental assembly.
const contributionsAtom = atom<Map<string, CellContribution>>(
  new Map(),
  'notebook.aiContext.contributions',
)

// Single serialized persist queue. A failed persist is caught + logged here (the
// local model is already current), so a backend outage never stalls the queue
// nor surfaces as an unhandled rejection.
let queueTail: Promise<void> = Promise.resolve()

function enqueue(task: () => Promise<unknown>): Promise<void> {
  const run = queueTail.then(task, task).then(
    () => undefined,
    (error: unknown) => {
      console.error('aiContext: failed to persist context', error)
    },
  )
  queueTail = run
  return run
}

// ─── Debounced-persist state (coalesces edits into one PUT) ───────────────────
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let pendingChangedIds = new Set<string>()
let pendingRemoved = false
// Pre-wrapped at startAiContextSync so it carries Reatom context into the timer.
let flushDebouncedPersist: (() => void) | null = null

/**
 * Flush any pending debounced persist and resolve when the queue is drained
 * (used on send). **Never rejects**: a failed persist is absorbed + logged in the
 * queue, so the caller cannot tell "persist succeeded" from "persist failed, the
 * cache is still current" — by design, generation proceeds with the local model
 * rather than blocking the user on a transient backend error.
 */
export function whenContextReady(): Promise<void> {
  flushDebouncedPersist?.()
  return queueTail
}

/** Reset the queue + caches + debounce state (test isolation / notebook switch). */
export function resetAiContextSync(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  pendingChangedIds = new Set()
  pendingRemoved = false
  flushDebouncedPersist = null
  queueTail = Promise.resolve()
  persistedContextAtom.set(null)
  contextLoadFailedAtom.set(false)
  contributionsAtom.set(new Map())
}

function buildContribution(cell: Cell): CellContribution {
  // Source + globals only — outputs are read live at generation time (they go
  // stale in a cache because a run does not bump the notebook revision).
  return {
    items: cellToContextItems(cell, { includeOutputs: false }),
    globals: cell.kind === 'code' ? extractDeclarations(cell.code()) : [],
  }
}

/** Rebuild every cell's contribution from scratch (initial seed / delete reset). */
function seedContributions(): void {
  const next = new Map<string, CellContribution>()
  for (const cell of cellsAtom()) next.set(cell.id, buildContribution(cell))
  contributionsAtom.set(next)
}

/** Recompute the given cells' contributions; prune any cell that no longer exists. */
function updateContributions(changedIds: string[]): void {
  const cells = cellsAtom()
  const byId = new Map(cells.map((cell) => [cell.id, cell]))
  const next = new Map(contributionsAtom())
  for (const id of changedIds) {
    const cell = byId.get(id)
    if (cell) next.set(id, buildContribution(cell))
  }
  for (const id of [...next.keys()]) {
    if (!byId.has(id)) next.delete(id)
  }
  contributionsAtom.set(next)
}

interface AssembleOptions {
  byteCap: number
  maxItems: number
  /** Restrict to the cells strictly above this one (the prompt cell). */
  beforeCellId?: string
  /** Append a live (freshly read) output digest after each cell's source. */
  includeOutputs?: boolean
}

/**
 * Assemble a context array from the cached per-cell contributions, in cell order.
 * Reads the incrementally-maintained cache (no re-parsing), optionally sliced to
 * the cells above the prompt cell and with live output digests appended.
 */
function assembleFromContributions(options: AssembleOptions): LlmContextCell[] {
  const { byteCap, maxItems, beforeCellId, includeOutputs = false } = options
  let cells = cellsAtom()
  if (beforeCellId !== undefined) {
    const idx = cells.findIndex((cell) => cell.id === beforeCellId)
    cells = idx === -1 ? cells : cells.slice(0, idx)
  }
  const contributions = contributionsAtom()
  const globals = mergeDeclarations(cells.map((cell) => contributions.get(cell.id)?.globals ?? []))
  const digest = formatGlobalsDigest(globals)
  const items: LlmContextCell[] = []
  if (digest) items.push({ kind: 'globals', source: truncateUtf8(digest, byteCap) })
  for (const cell of cells) {
    const contribution = contributions.get(cell.id)
    if (contribution) items.push(...contribution.items)
    if (includeOutputs) {
      const outDigest = outputsDigest(cell.output()) // live — never cached
      if (outDigest) {
        items.push({ kind: 'output', source: truncateUtf8(outDigest, MAX_OUTPUT_DIGEST_BYTES) })
      }
    }
  }
  return capContextItems(items, byteCap, maxItems)
}

/** Store-sized assembly (notebook-wide, source+globals; the backend rolls items to 10). */
function assembleStoreItems(): LlmContextCell[] {
  return assembleFromContributions({
    byteCap: CONTEXT_BYTE_CAP,
    maxItems: Number.MAX_SAFE_INTEGER,
  })
}

/**
 * Generation-sized assembly (≤ 10 items / 8 KiB) for `/llm/generate`, built from
 * the local working model: cell-aware (only the cells **above** the prompt cell,
 * matching the at-send rule §4.3) and with **live** output digests. Incremental
 * (no re-parsing); current even when the backend is unreachable. Empty when the
 * cache has not been seeded yet.
 */
export function assembleGenerationContext(beforeCellId?: string): LlmContextCell[] {
  return assembleFromContributions({
    byteCap: CONTEXT_BYTE_CAP,
    maxItems: MAX_CONTEXT_ITEMS,
    beforeCellId,
    includeOutputs: true,
  })
}

/** Snapshot the assembled store context now and enqueue its persistence (ordered). */
function persistAssembled(notebookId: string, clearFirst = false): Promise<unknown> {
  const items = assembleStoreItems()
  const apply = wrap((stored: AiContext) => persistedContextAtom.set(stored))
  return enqueue(async () => {
    if (clearFirst) await aiContext.clear(notebookId)
    const stored = await aiContext.put(notebookId, { context: items })
    apply(stored)
  })
}

/**
 * Load the last saved context on entry (remote store/sync). On failure: log and
 * flag it. Generation reads the local working model regardless, so a failed load
 * does not block it. Never rejects.
 */
export const loadPersistedContext = action(async (notebookId: string) => {
  try {
    const stored = await wrap(aiContext.get(notebookId))
    persistedContextAtom.set(stored)
    contextLoadFailedAtom.set(false)
    return stored
  } catch (error) {
    contextLoadFailedAtom.set(true)
    persistedContextAtom.set(null)
    console.error('aiContext: failed to load persisted context', error)
    return null
  }
}, 'notebook.aiContext.load')

/** Full rebuild: reseed every contribution from the current cells, then persist. */
export const scheduleContextRebuild = action((notebookId: string): Promise<unknown> => {
  seedContributions()
  return persistAssembled(notebookId)
}, 'notebook.aiContext.rebuild')

/**
 * Incrementally update the contributions of the given cells (recompute only
 * those, keep the rest), prune removed cells, and persist. This is the "modify,
 * don't regenerate from scratch" path.
 */
export const applyCellContextChanges = action(
  (notebookId: string, changedIds: string[]): Promise<unknown> => {
    updateContributions(changedIds)
    return persistAssembled(notebookId)
  },
  'notebook.aiContext.applyChanges',
)

/**
 * Clear the stored context and rebuild it from scratch — used after the user
 * deletes a cell, so stale context never lingers. Clear and rebuild are enqueued
 * as one ordered unit.
 */
export const clearAndRebuildContext = action((notebookId: string): Promise<unknown> => {
  seedContributions()
  return persistAssembled(notebookId, /* clearFirst */ true)
}, 'notebook.aiContext.clearAndRebuild')

function snapshotCells(cells: Cell[]): Map<string, string> {
  // Identity per cell = kind + source. Changes here mean the cell's contribution
  // must be recomputed; reorder alone leaves every entry identical.
  return new Map(cells.map((cell) => [cell.id, `${cell.kind}:${cell.code()}`]))
}

/**
 * Wire up persisted Mode B for a notebook: load the saved context on entry and
 * seed the per-cell cache (no PUT — we don't overwrite the loaded server state),
 * then keep the cache + backend in sync on every persisted content change.
 * Edits are **debounced** into one PUT; a delete clears + rebuilds. Returns an
 * unsubscribe. Driven off `notebookRevisionAtom` (bumps on edits + structural
 * ops). Note: outputs do not bump the revision, so persisted outputs are not
 * tracked here — generation reads outputs live instead.
 */
export function startAiContextSync(notebookId: string): () => void {
  void loadPersistedContext(notebookId)

  // Pre-wrapped: runs from the debounce timer (a fresh async boundary).
  flushDebouncedPersist = wrap(() => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    if (pendingChangedIds.size === 0 && !pendingRemoved) return
    const ids = [...pendingChangedIds]
    const removed = pendingRemoved
    pendingChangedIds = new Set()
    pendingRemoved = false
    if (removed) clearAndRebuildContext(notebookId)
    else applyCellContextChanges(notebookId, ids)
  })

  let previous = snapshotCells(cellsAtom())
  let primed = false
  const unsubscribe = notebookRevisionAtom.subscribe(() => {
    const current = snapshotCells(cellsAtom())
    if (!primed) {
      // First (synchronous) emit: seed the local cache only — no PUT, so the
      // loaded server context is not overwritten on entry.
      primed = true
      previous = current
      seedContributions()
      return
    }
    const removed = [...previous.keys()].some((id) => !current.has(id))
    const changed = [...current.keys()].filter((id) => previous.get(id) !== current.get(id))
    previous = current
    pendingRemoved = pendingRemoved || removed
    for (const id of changed) pendingChangedIds.add(id)
    if (pendingChangedIds.size === 0 && !pendingRemoved) return // pure reorder — nothing to persist
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => flushDebouncedPersist?.(), PERSIST_DEBOUNCE_MS)
  })

  return () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    flushDebouncedPersist = null
    unsubscribe()
  }
}
