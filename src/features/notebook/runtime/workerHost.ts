// Host facade for the sandbox worker.
//
// Public API:
//   runInWorker(code, scope?, options?) → Promise<RuntimeResult>
//   restartWorker() — drop the current worker (used by Restart Kernel later).
//
// Single worker per page. Calls serialise through a chain of promises:
//   a double-click on Run won't race two postMessages. The worker is lazy
//   (created on first run), and a hard timeout terminates + respawns it.

import type {
  HostMsg,
  OutputItem,
  RuntimeResult,
  RuntimeStatus,
  SharedScope,
  WorkerMsg,
} from './types'

export interface WorkerHostOptions {
  /** Maximum execution time, in ms. Default 30_000. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000
/** Soft cap on cumulative output size per run. Going above triggers a host
 *  terminate and a stderr marker, so a runaway `for(;;) console.log(...)`
 *  cannot OOM the page. 5 MB is roughly Jupyter's default. */
export const OUTPUT_BUDGET_BYTES = 5 * 1024 * 1024

let worker: Worker | null = null
let pending: Promise<unknown> = Promise.resolve()
/**
 * Resolver of the currently in-flight run, if any. Set when a run starts,
 * cleared on done/timeout. `restartWorker` calls this to free a stuck run
 * (e.g. while(true) interrupted by an external Stop).
 */
let inFlightResolver: ((scope: SharedScope) => void) | null = null

function ensureWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  return worker
}

/**
 * Drop the current worker so the next run gets a fresh one. Also frees
 * the currently waiting `runInWorker` promise so callers don't hang for
 * the full timeout.
 */
export function restartWorker(scope: SharedScope = {}): void {
  if (worker) {
    worker.terminate()
    worker = null
  }
  if (inFlightResolver) {
    const resolver = inFlightResolver
    inFlightResolver = null
    resolver(scope)
  }
  // Fresh chain — don't let an old run hold up the next call.
  pending = Promise.resolve()
}

function nextRunId(): string {
  return Math.random().toString(36).slice(2)
}

/**
 * Run a single piece of user code inside the worker. Serialises with
 * preceding calls, terminates the worker on timeout, returns a structured
 * result either way.
 */
export function runInWorker(
  code: string,
  scope: SharedScope = {},
  options: WorkerHostOptions = {},
): Promise<RuntimeResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const task = pending.then(() => runOne(code, scope, timeoutMs))
  // We swallow errors of the inner task in `pending` — they're already
  // captured in RuntimeResult; we just need a non-rejecting chain.
  pending = task.catch(() => undefined)
  return task
}

function runOne(code: string, scope: SharedScope, timeoutMs: number): Promise<RuntimeResult> {
  const w = ensureWorker()
  const runId = nextRunId()
  const items: OutputItem[] = []

  return new Promise<RuntimeResult>((resolve) => {
    const cleanup = () => {
      w.removeEventListener('message', onMessage)
      if (timer.ref) clearTimeout(timer.ref)
      inFlightResolver = null
    }

    // Single shared timer reference so cleanup can null it; we keep
    // const-binding via a never-firing nominal value for cleanup symmetry.
    const timer = { ref: 0 as unknown as ReturnType<typeof setTimeout> | null }
    let bytesSoFar = 0
    let truncated = false
    const onMessage = (event: MessageEvent<WorkerMsg>) => {
      const m = event.data
      if (m.runId !== runId) return
      if (m.kind === 'output') {
        if (truncated) return // discard everything after the limit fires
        bytesSoFar += measureItemBytes(m.item)
        items.push(m.item)
        if (bytesSoFar > OUTPUT_BUDGET_BYTES) {
          truncated = true
          items.push({
            type: 'stderr',
            text: `Output truncated at ${OUTPUT_BUDGET_BYTES} bytes`,
          })
          cleanup()
          restartWorker(scope)
          resolve({ status: 'error', items, scope })
        }
        return
      }
      // 'done'
      cleanup()
      resolve({ status: m.status, items, scope: m.scope })
    }
    w.addEventListener('message', onMessage)

    // Allow external restartWorker() to unstick this run — resolves as
    // 'interrupted' so the caller can update cell status accordingly.
    inFlightResolver = (carriedScope) => {
      cleanup()
      resolve({ status: 'interrupted', items, scope: carriedScope })
    }

    timer.ref = setTimeout(() => {
      cleanup()
      restartWorker(scope)
      resolve(timedOutResult(timeoutMs, scope))
    }, timeoutMs + 100)
    // Don't pin the Node event loop — vitest waits for handles to settle.
    if (typeof (timer.ref as unknown as { unref?: () => void }).unref === 'function') {
      ;(timer.ref as unknown as { unref: () => void }).unref()
    }

    const runMsg: HostMsg = { kind: 'run', runId, code, scope, timeoutMs }
    w.postMessage(runMsg)
  })
}

function timedOutResult(timeoutMs: number, scope: SharedScope): RuntimeResult {
  const status: RuntimeStatus = 'timeout'
  const items: OutputItem[] = [{ type: 'stderr', text: `Execution timed out after ${timeoutMs}ms` }]
  return { status, items, scope }
}

/**
 * Rough byte budget per output item. We don't need a perfect number —
 * just enough to stop a `for (let i=0; i<1e7; i++) console.log('xxx')`
 * loop before it OOMs the page.
 */
function measureItemBytes(item: OutputItem): number {
  switch (item.type) {
    case 'stdout':
    case 'stderr':
      return item.text.length
    case 'error':
      return item.name.length + item.message.length + (item.stack?.length ?? 0)
    case 'result':
      // SerializedValue stringify is fast enough at this scale; the budget
      // is forgiving so an order-of-magnitude estimate is fine.
      return JSON.stringify(item.value).length
  }
}
