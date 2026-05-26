// Reatom-level runtime for the notebook: per-cell execution, queue (Run
// All), Stop, Stop All, Restart Kernel, and the monotonic execution
// counter that drives the [N] badge.
//
// Why it lives in its own file: this is a coherent stateful concept ("the
// kernel") that owns multiple cells. Keeping it next to `notebook.ts`
// (which is just CRUD over cellsAtom) lets either file stay readable.

import { action, atom, wrap } from '@reatom/core'
import { restartWorker, runInWorker } from '../runtime/workerHost'
import type { OutputItem, RuntimeStatus, SharedScope } from '../runtime/types'
import type { Cell, CellStatus } from '../domain/cell'
import { cellsAtom, sharedScopeAtom } from './notebook'
import { timeoutMsAtom } from './notebookSettings'

export type KernelStatus = 'idle' | 'busy'

/** True while the kernel is processing a cell or working through the queue. */
export const runtimeStatusAtom = atom<KernelStatus>('idle', 'runtime.status')

/** Monotonic counter incremented by each run; restartKernel resets it to 0. */
export const execCounterAtom = atom<number>(0, 'runtime.execCounter')

/** Pending cells in submission order; first element is being processed. */
export const queueAtom = atom<string[]>([], 'runtime.queue')

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

  const scope = sharedScopeAtom()
  const timeoutMs = timeoutMsAtom()
  const result = await wrap(runInWorker(cell.code(), scope, { timeoutMs }))
  currentCellId = null
  sharedScopeAtom.set(result.scope)
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
  if (status === 'done') return 'done'
  // 'timeout' and 'interrupted' surface as 'error' for now — the structured
  // status name is preserved in the cell.output stderr text. We could add
  // a 'timeout' cell status later if the UI needs to differentiate.
  return 'error'
}

// ─── Run All ─────────────────────────────────────────────────────────────────

export const runAll = action(async () => {
  stopAllRequested = false
  const ids = cellsAtom()
    .filter((c) => c.kind === 'code')
    .map((c) => c.id)
  queueAtom.set(ids)

  while (queueAtom().length > 0) {
    if (stopAllRequested) {
      // Mark remaining as skipped, drain the queue.
      for (const rest of queueAtom()) {
        const cell = cellsAtom().find((c) => c.id === rest)
        cell?.status.set('skipped')
      }
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
      // Skip the remaining cells on first error / timeout / interrupt.
      for (const rest of queueAtom()) {
        const restCell = cellsAtom().find((c) => c.id === rest)
        restCell?.status.set('skipped')
      }
      queueAtom.set([])
      return
    }
  }
}, 'runtime.runAll')

// ─── Stop ────────────────────────────────────────────────────────────────────

export const stopCell = action((id: string) => {
  markStopRequest(id)
  // Hard-terminate the worker — sandbox VM may be in a tight loop where
  // postMessage cannot reach it.
  restartWorker()
}, 'runtime.stopCell')

export const stopAll = action(() => {
  stopAllRequested = true
  // Mark the cell currently being processed (already pulled off the
  // queue) plus any still-queued cells, so mapStatus surfaces them all
  // as 'interrupted'.
  if (currentCellId) markStopRequest(currentCellId)
  for (const id of queueAtom()) markStopRequest(id)
  restartWorker()
}, 'runtime.stopAll')

// ─── Restart Kernel ──────────────────────────────────────────────────────────

export const restartKernel = action(() => {
  restartWorker()
  sharedScopeAtom.set({} as SharedScope)
  execCounterAtom.set(0)
  queueAtom.set([])
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
