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

import type { HostMsg, OutputItem, RuntimeResult, WorkerMsg } from './types'

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

const DEFAULT_TIMEOUT_MS = 30_000
/** Soft cap on cumulative output size per run. Going above terminates the
 *  worker and appends a stderr marker, so a runaway `for(;;) console.log(...)`
 *  cannot OOM the page. 5 MB is roughly Jupyter's default. */
export const OUTPUT_BUDGET_BYTES = 5 * 1024 * 1024

let worker: WorkerLike | null = null
let pending: Promise<unknown> = Promise.resolve()
/**
 * Resolver of the currently in-flight run, if any. Set when a run starts,
 * cleared on done/timeout. `restartWorker` calls this to free a stuck run
 * (e.g. while(true) interrupted by an external Stop).
 */
let inFlightResolver: (() => void) | null = null

function ensureWorker(): WorkerLike {
  if (worker) return worker
  worker = workerFactory()
  return worker
}

/**
 * Drop the current worker so the next run gets a fresh kernel. Also frees
 * the currently waiting `runInWorker` promise (as 'interrupted') so callers
 * don't hang for the full timeout. Used by Restart Kernel and by Stop's
 * terminate fallback.
 */
export function restartWorker(): void {
  if (worker) {
    worker.terminate()
    worker = null
  }
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
      // Preserve output streamed before the hang; append the timeout marker.
      resolve({
        status: 'timeout',
        items: [...items, { type: 'stderr', text: `Execution timed out after ${timeoutMs}ms` }],
      })
    }, timeoutMs + 100)

    const runMsg: HostMsg = { kind: 'run', runId, code, timeoutMs }
    w.postMessage(runMsg)
  })
}

/**
 * Rough byte budget per output item. An order-of-magnitude estimate is
 * enough to stop a `for (let i=0; i<1e7; i++) console.log('xxx')` loop
 * before it OOMs the page.
 */
function measureItemBytes(item: OutputItem): number {
  switch (item.type) {
    case 'stdout':
    case 'stderr':
      return item.text.length
    case 'error':
      return item.name.length + item.message.length + (item.stack?.length ?? 0)
    case 'result':
      try {
        return JSON.stringify(item.value).length
      } catch {
        return 0
      }
    case 'html':
      return item.html.length
    case 'image':
      return item.data.length + item.mime.length
  }
}
