// Reatom-level runtime for the notebook: per-cell execution, queue (Run
// All), Stop, Stop All, Restart Kernel, and the monotonic execution
// counter that drives the [N] badge.
//
// Why it lives in its own file: this is a coherent stateful concept ("the
// kernel") that owns multiple cells. Keeping it next to `notebook.ts`
// (which is just CRUD over cellsAtom) lets either file stay readable.

import { action, atom, wrap } from '@reatom/core'
import { requestInterrupt, restartWorker, runInWorker } from '../runtime/workerHost'
import type { OutputItem, RuntimeStatus } from '../runtime/types'
import type { Cell, CellStatus } from '../domain/cell'
import { cellsAtom } from './notebook'
import { timeoutMsAtom } from './notebookSettings'

export type KernelStatus = 'idle' | 'busy'

/** True while the kernel is processing a cell or working through the queue. */
export const runtimeStatusAtom = atom<KernelStatus>('idle', 'runtime.status')

/** Monotonic counter incremented by each run; restartKernel resets it to 0. */
export const execCounterAtom = atom<number>(0, 'runtime.execCounter')

/** Pending cells in submission order; first element is being processed. */
export const queueAtom = atom<string[]>([], 'runtime.queue')

/**
 * Cells that were short-circuited as `skipped` by the most recent
 * `runAll` (because an earlier cell failed). Drives the Continue button:
 * non-empty means the user can resume the queue from this list without
 * re-running the cells that already succeeded.
 */
export const skippedCellsAtom = atom<string[]>([], 'runtime.skippedCells')

/**
 * Cells the user has explicitly stopped during the current run. Module-
 * level mutable state (not an atom) so that synchronous stopCell handlers
 * are guaranteed to be observable by the in-flight executeCell without
 * any Reatom context plumbing.
 */
const stopRequested = new Set<string>()
let stopAllRequested = false
/** Id of the cell currently being executed (if any). */
let currentCellId: string | null = null

// ─── Run a single cell ───────────────────────────────────────────────────────

export const runCell = action(async (id: string) => {
  const cell = cellsAtom().find((c) => c.id === id)
  if (!cell) return
  await executeCell(cell)
}, 'runtime.runCell')

async function executeCell(cell: Cell): Promise<RuntimeStatus> {
  // Reset stop request for this cell, mark running, allocate a counter slot.
  clearStopRequest(cell.id)
  currentCellId = cell.id
  runtimeStatusAtom.set('busy')
  cell.status.set('running')
  cell.output.set([])
  const counter = execCounterAtom() + 1
  execCounterAtom.set(counter)
  cell.executionCount.set(counter)

  const timeoutMs = timeoutMsAtom()
  // Shared scope lives inside the persistent worker VM — no snapshot is
  // passed here or carried back.
  const result = await wrap(runInWorker(cell.code(), { timeoutMs }))
  currentCellId = null
  cell.output.set(result.items)
  const finalStatus = mapStatus(cell.id, result.status, result.items)
  cell.status.set(finalStatus)
  runtimeStatusAtom.set('idle')
  return result.status
}

/**
 * Translate the runtime status into a cell status, honoring user-driven
 * stops. If the user pressed Stop for this cell, surface as 'interrupted'
 * regardless of what the worker reported.
 */
function mapStatus(id: string, status: RuntimeStatus, items: OutputItem[]): CellStatus {
  if (consumeStopRequest(id)) {
    items.push({ type: 'stderr', text: 'Execution interrupted by user' })
    return 'interrupted'
  }
  // Runtime statuses map 1:1 onto cell statuses so the UI and the queue can
  // tell a timeout from a plain error. Add an explicit output marker for the
  // non-error terminal states (a deadline interrupt aborts inside the VM, so
  // there is no host-side message otherwise).
  switch (status) {
    case 'done':
      return 'done'
    case 'timeout':
      items.push({ type: 'stderr', text: 'Execution timed out' })
      return 'timeout'
    case 'interrupted':
      items.push({ type: 'stderr', text: 'Execution interrupted by user' })
      return 'interrupted'
    case 'error':
      return 'error'
  }
}

// ─── Run All ─────────────────────────────────────────────────────────────────

export const runAll = action(async () => {
  // Fresh queue invalidates any previous skipped trail.
  skippedCellsAtom.set([])
  const ids = cellsAtom()
    .filter((c) => c.kind === 'code')
    .map((c) => c.id)
  await processQueue(ids)
}, 'runtime.runAll')

/**
 * Resume execution from cells that were marked `skipped` by the previous
 * `runAll`. Cells that are no longer skipped (e.g. user ran one manually)
 * are filtered out so we never run the same cell twice in a row.
 */
export const resumeQueue = action(async () => {
  const candidates = skippedCellsAtom()
  const stillSkipped = candidates.filter((id) => {
    const cell = cellsAtom().find((c) => c.id === id)
    return cell?.status() === 'skipped'
  })
  skippedCellsAtom.set([])
  if (stillSkipped.length === 0) return
  await processQueue(stillSkipped)
}, 'runtime.resumeQueue')

/**
 * Sequential queue worker. Shared between `runAll` and `resumeQueue` so
 * the skip-on-error / stopAll semantics live in exactly one place.
 */
async function processQueue(ids: string[]): Promise<void> {
  stopAllRequested = false
  queueAtom.set(ids)

  while (queueAtom().length > 0) {
    if (stopAllRequested) {
      // Stop All: don't carry the rest forward as skipped (they were not
      // skipped by an error, the user explicitly stopped the queue).
      for (const rest of queueAtom()) {
        const cell = cellsAtom().find((c) => c.id === rest)
        cell?.status.set('skipped')
      }
      skippedCellsAtom.set(queueAtom())
      queueAtom.set([])
      stopAllRequested = false
      return
    }
    const [head, ...tail] = queueAtom()
    queueAtom.set(tail)
    const cell = cellsAtom().find((c) => c.id === head)
    if (!cell) continue
    const status = await executeCell(cell)
    if (status !== 'done') {
      const remaining = queueAtom()
      for (const rest of remaining) {
        const restCell = cellsAtom().find((c) => c.id === rest)
        restCell?.status.set('skipped')
      }
      skippedCellsAtom.set(remaining)
      queueAtom.set([])
      return
    }
  }
}

// ─── Stop ────────────────────────────────────────────────────────────────────

export const stopCell = action((id: string) => {
  markStopRequest(id)
  // Cooperative interrupt: when cross-origin isolated, the VM aborts the
  // tight loop via the shared flag and keeps its scope. Otherwise this
  // falls back to terminating the worker.
  requestInterrupt()
}, 'runtime.stopCell')

export const stopAll = action(() => {
  stopAllRequested = true
  // Mark the cell currently being processed (already pulled off the
  // queue) plus any still-queued cells, so mapStatus surfaces them all
  // as 'interrupted'.
  if (currentCellId) markStopRequest(currentCellId)
  for (const id of queueAtom()) markStopRequest(id)
  requestInterrupt()
}, 'runtime.stopAll')

// ─── Restart Kernel ──────────────────────────────────────────────────────────

export const restartKernel = action(() => {
  // Terminating the worker drops the persistent VM; the next run spins up a
  // fresh kernel with an empty scope.
  restartWorker()
  execCounterAtom.set(0)
  queueAtom.set([])
  skippedCellsAtom.set([])
  stopAllRequested = false
  stopRequested.clear()
  currentCellId = null
  for (const cell of cellsAtom()) {
    cell.status.set('idle')
    cell.executionCount.set(null)
    cell.output.set([])
  }
}, 'runtime.restartKernel')

// ─── helpers ─────────────────────────────────────────────────────────────────

function markStopRequest(id: string): void {
  stopRequested.add(id)
}

function consumeStopRequest(id: string): boolean {
  return stopRequested.delete(id)
}

function clearStopRequest(id: string): void {
  stopRequested.delete(id)
}
