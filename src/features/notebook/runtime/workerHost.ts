// Host facade for the sandbox worker.
//
// Public API:
//   runInWorker(code, options?) → Promise<RuntimeResult>
//   restartWorker() — drop the current worker (Restart Kernel / Stop).
//
// Single worker per page, holding a persistent QuickJS kernel. Calls
// serialise through a chain of promises so a double-click on Run won't race
// two postMessages. The worker is lazy (created on first run); a hard
// timeout terminates + respawns it as a safety net, and an external
// `restartWorker()` unsticks an in-flight run (used by Stop).

import { DEFAULT_TIMEOUT_MS } from './limits'
import { OUTPUT_BUDGET_BYTES, measureItemBytes } from './outputBudget'
import type { HostMsg, OutputItem, RuntimeResult, WorkerMsg } from './types'

// Re-export so existing importers (tests, runtime model) keep their path.
export { OUTPUT_BUDGET_BYTES } from './outputBudget'

export interface WorkerHostOptions {
  /** Maximum execution time, in ms. Default 30_000. */
  timeoutMs?: number
}

/**
 * Minimal Worker contract used by the host facade. Real production code
 * gets the browser `Worker`; tests can plug an inline implementation via
 * `setWorkerFactory` for synchronous behavior without `@vitest/web-worker`.
 */
export interface WorkerLike {
  postMessage(msg: HostMsg): void
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerMsg>) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<WorkerMsg>) => void): void
  terminate(): void
}

export type WorkerFactory = () => WorkerLike

const defaultWorkerFactory: WorkerFactory = () =>
  new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike

let workerFactory: WorkerFactory = defaultWorkerFactory

/**
 * Swap the worker factory. Returns a restorer so a test can put the
 * default back without coupling to the production import.
 */
export function setWorkerFactory(factory: WorkerFactory): () => void {
  const previous = workerFactory
  workerFactory = factory
  restartWorker()
  return () => {
    workerFactory = previous
    restartWorker()
  }
}

/**
 * How long Stop waits for a cooperative SAB-interrupt to land before it falls
 * back to terminating the worker. The SAB flag only aborts a VM that is
 * running bytecode; code parked in a pending promise (`await new Promise(()
 * => {})`) never hits the interrupt handler, so without this watchdog Stop
 * would hang until the full execution timeout. 250 ms keeps Stop well under
 * the ≤500 ms acceptance budget while giving the fast path room to win.
 */
const INTERRUPT_WATCHDOG_MS = 250

let worker: WorkerLike | null = null
let pending: Promise<unknown> = Promise.resolve()
/**
 * Resolver of the currently in-flight run, if any. Set when a run starts,
 * cleared on done/timeout. `restartWorker` calls this to free a stuck run
 * (e.g. while(true) interrupted by an external Stop).
 */
let inFlightResolver: (() => void) | null = null

/**
 * Shared interrupt flag (`Int32Array` over a `SharedArrayBuffer`). Created
 * once per worker when the page is cross-origin isolated. The worker reads
 * slot 0 from its interrupt handler, so the host can stop a blocked VM by
 * writing 1 here — without terminating the worker, so the scope survives.
 * `null` when isolation is unavailable; Stop then falls back to terminate.
 */
let interruptFlag: Int32Array | null = null

/** Active Stop watchdog timer (SAB-interrupt fallback). See requestInterrupt. */
let interruptWatchdog: ReturnType<typeof setTimeout> | null = null

function isolated(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true
  )
}

function ensureWorker(): WorkerLike {
  if (worker) return worker
  worker = workerFactory()
  // Hand the fresh worker a shared interrupt buffer when isolation allows it.
  if (isolated() && typeof SharedArrayBuffer !== 'undefined') {
    const buffer = new SharedArrayBuffer(4)
    interruptFlag = new Int32Array(buffer)
    worker.postMessage({ kind: 'init', interruptBuffer: buffer })
  } else {
    interruptFlag = null
  }
  return worker
}

/**
 * Request a cooperative interrupt of the in-flight run (Stop / Stop All).
 * When a shared buffer is available the VM aborts itself and keeps its
 * scope; otherwise we terminate the worker as a fallback (scope is lost,
 * the next run spins up a fresh kernel).
 */
export function requestInterrupt(): void {
  if (interruptFlag) {
    Atomics.store(interruptFlag, 0, 1)
    // The SAB flag aborts a VM only while it executes bytecode. If user code
    // is parked in a pending promise, the interrupt handler never runs — arm
    // a watchdog that terminates the worker if the run hasn't resolved in
    // time, so Stop still completes promptly (scope is lost in that case).
    armInterruptWatchdog()
    return
  }
  restartWorker()
}

function armInterruptWatchdog(): void {
  clearInterruptWatchdog()
  interruptWatchdog = setTimeout(() => {
    interruptWatchdog = null
    // Still in flight => the cooperative interrupt didn't land; force it.
    if (inFlightResolver) restartWorker()
  }, INTERRUPT_WATCHDOG_MS)
}

function clearInterruptWatchdog(): void {
  if (interruptWatchdog) {
    clearTimeout(interruptWatchdog)
    interruptWatchdog = null
  }
}

/**
 * Drop the current worker so the next run gets a fresh kernel. Also frees
 * the currently waiting `runInWorker` promise (as 'interrupted') so callers
 * don't hang for the full timeout. Used by Restart Kernel and by Stop's
 * terminate fallback.
 */
export function restartWorker(): void {
  clearInterruptWatchdog()
  if (worker) {
    worker.terminate()
    worker = null
  }
  interruptFlag = null
  if (inFlightResolver) {
    const resolver = inFlightResolver
    inFlightResolver = null
    resolver()
  }
  pending = Promise.resolve()
}

function nextRunId(): string {
  // crypto.randomUUID is available in both browser and worker contexts.
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
}

/**
 * Run a single piece of user code inside the worker. Serialises with
 * preceding calls, terminates the worker on timeout, returns a structured
 * result either way.
 */
export function runInWorker(code: string, options: WorkerHostOptions = {}): Promise<RuntimeResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const task = pending.then(() => runOne(code, timeoutMs))
  // Swallow inner errors in the chain — they're captured in RuntimeResult;
  // we just need a non-rejecting `pending`.
  pending = task.catch(() => undefined)
  return task
}

function runOne(code: string, timeoutMs: number): Promise<RuntimeResult> {
  const w = ensureWorker()
  const runId = nextRunId()
  const items: OutputItem[] = []

  return new Promise<RuntimeResult>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      w.removeEventListener('message', onMessage)
      if (timer) clearTimeout(timer)
      timer = null
      clearInterruptWatchdog()
      inFlightResolver = null
    }

    let bytesSoFar = 0
    let truncated = false
    const onMessage = (event: MessageEvent<WorkerMsg>) => {
      const m = event.data
      if (m.runId !== runId) return
      if (m.kind === 'output') {
        if (truncated) return
        const itemBytes = measureItemBytes(m.item)
        if (bytesSoFar + itemBytes > OUTPUT_BUDGET_BYTES) {
          // Enforce the budget BEFORE accepting the item, so a single huge
          // item can't blow past the limit.
          truncated = true
          items.push({
            type: 'stderr',
            text: `Output truncated at ${OUTPUT_BUDGET_BYTES} bytes`,
          })
          cleanup()
          restartWorker()
          resolve({ status: 'error', items })
          return
        }
        bytesSoFar += itemBytes
        items.push(m.item)
        return
      }
      // 'done'
      cleanup()
      resolve({ status: m.status, items })
    }
    w.addEventListener('message', onMessage)

    // Allow external restartWorker() to unstick this run — resolves as
    // 'interrupted', carrying any output streamed before the stop.
    inFlightResolver = () => {
      cleanup()
      resolve({ status: 'interrupted', items })
    }

    timer = setTimeout(() => {
      cleanup()
      restartWorker()
      // Preserve any output streamed before the hang. The human-readable
      // timeout marker is added by the runtime model (mapStatus), the single
      // source for terminal-status messages — so both the in-VM deadline path
      // and this host-watchdog path produce exactly one marker.
      resolve({ status: 'timeout', items })
    }, timeoutMs + 100)

    // Clear any stale interrupt request from a previous run before starting.
    if (interruptFlag) Atomics.store(interruptFlag, 0, 0)
    const runMsg: HostMsg = { kind: 'run', runId, code, timeoutMs }
    w.postMessage(runMsg)
  })
}
