// Reatom-level runtime for the notebook: per-cell execution, queue (Run
// All), Stop, Stop All, Restart Kernel, and the monotonic execution
// counter that drives the [N] badge.
//
// Why it lives in its own file: this is a coherent stateful concept ("the
// kernel") that owns multiple cells. Keeping it next to `notebook.ts`
// (which is just CRUD over cellsAtom) lets either file stay readable.

import { action, atom, wrap } from '@reatom/core'
import { requestInterrupt, restartWorker, runInWorker } from '../runtime/workerHost'
import { clampTimeoutMs } from '../runtime/limits'
import type { OutputItem, RuntimeStatus } from '../runtime/types'
import type { Cell, CellStatus } from '../domain/cell'
import { cellsAtom } from './notebook'
import { enterCommand } from './cellMode'
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
/**
 * Monotonic kernel "generation". Bumped by `restartKernel`, so an
 * `executeCell` that was in flight when the user restarted can detect that
 * its kernel is gone and refuse to write stale state over the fresh reset.
 */
let kernelGeneration = 0

/**
 * True while a cell is part of the current run — either executing right now
 * (`currentCellId`) or still waiting in the Run All queue. Callers use this to
 * refuse structural edits (change-kind) on a cell that the kernel is about to
 * run: changing kind mid-queue would otherwise let a now-markdown cell reach
 * `executeCell` as if it were code. The UI layer reads it (no `notebook.ts ->
 * runtime.ts` import, so the model stays acyclic).
 */
export function isCellQueuedOrRunning(id: string): boolean {
  return currentCellId === id || queueAtom().includes(id)
}

// ─── Run a single cell ───────────────────────────────────────────────────────

export const runCell = action(async (id: string) => {
  // Single kernel per page: refuse a manual run while busy so two runs can't
  // race the queue, the currentCellId slot, or the runtime status.
  if (runtimeStatusAtom() === 'busy') return
  const cell = cellsAtom().find((c) => c.id === id)
  if (!cell) return
  runtimeStatusAtom.set('busy')
  try {
    // `wrap` re-binds the Reatom context across the await boundary. Without
    // it the continuation (`runtimeStatusAtom.set('idle')` in finally) runs
    // with no active stack and throws `missing async stack` under the
    // production `clearStack()` — leaving the toolbar stuck at 'busy'.
    await wrap(executeCell(cell))
  } finally {
    runtimeStatusAtom.set('idle')
  }
}, 'runtime.runCell')

/**
 * Run one cell end to end. Owns per-cell state (status, output, counter) but
 * NOT the kernel-level `runtimeStatusAtom` — the caller (runCell or the queue)
 * holds 'busy' across the whole operation so it never flickers to 'idle'
 * between queued cells.
 */
async function executeCell(cell: Cell): Promise<RuntimeStatus> {
  clearStopRequest(cell.id)
  currentCellId = cell.id
  cell.status.set('running')
  cell.output.set([])
  const counter = execCounterAtom() + 1
  execCounterAtom.set(counter)
  cell.executionCount.set(counter)

  const generation = kernelGeneration
  // Clamp the user-set timeout into the supported range so a bad/zero value
  // can't make every cell time out instantly or run effectively forever.
  const timeoutMs = clampTimeoutMs(timeoutMsAtom())
  // Stream items into the cell as the worker produces them, so a long run
  // shows output incrementally instead of all at once at the end. The worker
  // can emit thousands of items in a burst, so we BATCH them: each item lands
  // in a buffer and a single flush (scheduled on the next animation frame)
  // appends the whole chunk. This turns a per-item `set([...prev, item])`
  // (O(n²) copies + a re-render each) into one append per frame.
  let buffer: OutputItem[] = []
  let flushScheduled = false
  // `wrap` captures the current Reatom context so the flush (fired later from
  // a timer/rAF — a fresh async boundary) can touch atoms under clearStack().
  // A stale generation (Restart during the run) makes it a no-op.
  const flush = wrap(() => {
    flushScheduled = false
    if (generation !== kernelGeneration || buffer.length === 0) return
    const chunk = buffer
    buffer = []
    cell.output.set((prev) => prev.concat(chunk))
  })
  const onItem = wrap((item: OutputItem) => {
    if (generation !== kernelGeneration) return
    buffer.push(item)
    if (flushScheduled) return
    flushScheduled = true
    scheduleFlush(flush)
  })
  // Shared scope lives inside the persistent worker VM — no snapshot is
  // passed here or carried back.
  const result = await wrap(runInWorker(cell.code(), { timeoutMs, onItem }))

  // Drop any buffered-but-unflushed items and cancel the pending flush: the
  // authoritative list is written below, so a late flush must not append a
  // stale chunk on top of it (or resurrect output after Restart).
  buffer = []
  flushScheduled = false

  // A Restart Kernel during the run bumped the generation and already reset
  // this cell to idle. Writing the result now would resurrect stale output on
  // top of the fresh kernel, so bail out without touching cell state.
  if (generation !== kernelGeneration) return result.status

  currentCellId = null
  // Build the final (status, items) in one shot and write atomically — no
  // post-set mutation of an array already handed to the output atom.
  const mapped = mapStatus(cell.id, result.status, result.items)
  cell.output.set(mapped.items)
  cell.status.set(mapped.status)
  return result.status
}

/**
 * Schedule an output flush on the next animation frame, falling back to a
 * macrotask in non-DOM contexts (jsdom tests, the off chance rAF is absent).
 * Coalescing on a frame keeps a bursty run to one atom write + render per
 * frame instead of one per item.
 */
function scheduleFlush(fn: () => void): void {
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(() => fn())
  } else {
    setTimeout(fn, 0)
  }
}

/**
 * Build the final (cell status, output items) for a finished run, honoring
 * user-driven stops. Pure: returns a NEW items array with any terminal
 * marker appended, so the caller writes the output atom exactly once instead
 * of mutating the worker result after it's already been handed to an atom.
 */
function mapStatus(
  id: string,
  status: RuntimeStatus,
  items: OutputItem[],
): { status: CellStatus; items: OutputItem[] } {
  const withMarker = (text: string): OutputItem[] => [...items, { type: 'stderr', text }]
  if (consumeStopRequest(id)) {
    return { status: 'interrupted', items: withMarker('Execution interrupted by user') }
  }
  // Runtime statuses map 1:1 onto cell statuses so the UI and the queue can
  // tell a timeout from a plain error. Add an explicit output marker for the
  // non-error terminal states (a deadline interrupt aborts inside the VM, so
  // there is no host-side message otherwise).
  switch (status) {
    case 'done':
      return { status: 'done', items }
    case 'timeout':
      return { status: 'timeout', items: withMarker('Execution timed out') }
    case 'interrupted':
      return { status: 'interrupted', items: withMarker('Execution interrupted by user') }
    case 'error':
      return { status: 'error', items }
  }
}

// ─── Run All ─────────────────────────────────────────────────────────────────

export const runAll = action(async () => {
  if (runtimeStatusAtom() === 'busy') return
  // TARDIS-167 (№18): leave edit mode FIRST. A text cell focused in edit mode
  // would otherwise keep `cellModeAtom === 'edit'` and its textarea focused, so
  // "Run All" skipped rendering it (it fell out of the flow). Dropping to command
  // mode before the markdown→preview flip below makes every cell participate.
  enterCommand()
  // "Run All" evaluates the whole notebook end to end. For a code cell that is
  // execution; for a text cell it is rendering — so flip every markdown cell to
  // its preview (a non-empty one renders, an empty one stays a blank box, which
  // NotebookCell already handles). Done here, not in processQueue, because the
  // queue only holds code ids.
  for (const cell of cellsAtom()) {
    if (cell.kind === 'markdown') cell.viewMode.set('preview')
  }
  // Fresh queue invalidates any previous skipped trail.
  skippedCellsAtom.set([])
  const ids = cellsAtom()
    .filter((c) => c.kind === 'code')
    .map((c) => c.id)
  runtimeStatusAtom.set('busy')
  try {
    await wrap(processQueue(ids))
  } finally {
    runtimeStatusAtom.set('idle')
  }
}, 'runtime.runAll')

/**
 * Resume execution from cells that were marked `skipped` by the previous
 * `runAll`. Cells that are no longer skipped (e.g. user ran one manually)
 * are filtered out so we never run the same cell twice in a row.
 */
export const resumeQueue = action(async () => {
  if (runtimeStatusAtom() === 'busy') return
  const candidates = skippedCellsAtom()
  const stillSkipped = candidates.filter((id) => {
    const cell = cellsAtom().find((c) => c.id === id)
    return cell?.status() === 'skipped'
  })
  skippedCellsAtom.set([])
  if (stillSkipped.length === 0) return
  runtimeStatusAtom.set('busy')
  try {
    await wrap(processQueue(stillSkipped))
  } finally {
    runtimeStatusAtom.set('idle')
  }
}, 'runtime.resumeQueue')

/**
 * Sequential queue worker. Shared between `runAll` and `resumeQueue` so
 * the skip-on-error / stopAll semantics live in exactly one place.
 */
async function processQueue(ids: string[]): Promise<void> {
  stopAllRequested = false
  queueAtom.set(ids)

  while (queueAtom().length > 0) {
    const [head, ...tail] = queueAtom()
    queueAtom.set(tail)
    const cell = cellsAtom().find((c) => c.id === head)
    if (!cell) continue
    // The queue holds ids, captured when Run All started; a cell's kind can
    // change before its turn (e.g. `M` converts it to markdown). Re-check here
    // so a now-markdown cell is never executed as JS — markdown has no run.
    if (cell.kind !== 'code') continue
    const status = await wrap(executeCell(cell))

    if (stopAllRequested) {
      // Stop All is a user action, not an error: drain the rest back to
      // 'idle' and leave NO resume trail — the user explicitly stopped, so
      // a Continue button would let them resume what they just halted.
      drainQueue('idle')
      skippedCellsAtom.set([])
      stopAllRequested = false
      return
    }

    if (status !== 'done') {
      // Error / timeout: mark the rest skipped so the user can fix-and-resume.
      const remaining = queueAtom()
      drainQueue('skipped')
      skippedCellsAtom.set(remaining)
      return
    }
  }
}

/** Empty the queue, setting every still-pending cell to `status`. */
function drainQueue(status: CellStatus): void {
  for (const id of queueAtom()) {
    cellsAtom()
      .find((c) => c.id === id)
      ?.status.set(status)
  }
  queueAtom.set([])
}

// ─── Stop ────────────────────────────────────────────────────────────────────

export const stopCell = action((id: string) => {
  if (currentCellId === id) {
    // The cell is actually running — interrupt the VM. Cooperative when
    // cross-origin isolated (scope survives), terminate as a fallback.
    markStopRequest(id)
    requestInterrupt()
    return
  }
  // The cell is only queued, not running: drop it from the queue and reset
  // it to idle. Do NOT touch the worker — that would kill the cell that IS
  // running (e.g. during Run All).
  if (queueAtom().includes(id)) {
    queueAtom.set((q) => q.filter((x) => x !== id))
    cellsAtom()
      .find((c) => c.id === id)
      ?.status.set('idle')
  }
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
  // Invalidate any in-flight executeCell: its continuation will see the bumped
  // generation after `await` and skip writing stale state over this reset.
  kernelGeneration++
  // Terminating the worker drops the persistent VM; the next run spins up a
  // fresh kernel with an empty scope.
  restartWorker()
  // Always return to idle: a kernel stuck 'busy' (e.g. a hung run) must be
  // unblocked by Restart, otherwise the toolbar stays disabled forever.
  runtimeStatusAtom.set('idle')
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
