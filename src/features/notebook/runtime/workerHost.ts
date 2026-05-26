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

let worker: Worker | null = null
let pending: Promise<unknown> = Promise.resolve()

function ensureWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  return worker
}

/** Drop the current worker so the next run gets a fresh one. */
export function restartWorker(): void {
  if (worker) {
    worker.terminate()
    worker = null
  }
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
      clearTimeout(timer)
    }

    const onMessage = (event: MessageEvent<WorkerMsg>) => {
      const m = event.data
      if (m.runId !== runId) return
      if (m.kind === 'output') {
        items.push(m.item)
        return
      }
      // 'done'
      cleanup()
      resolve({ status: m.status, items, scope: m.scope })
    }
    w.addEventListener('message', onMessage)

    const timer = setTimeout(() => {
      cleanup()
      // Hard kill the worker — the QuickJS deadline-interrupt may not be
      // enough (e.g. a future native blocking call). A fresh worker is
      // cheap.
      restartWorker()
      resolve(timedOutResult(timeoutMs, scope))
    }, timeoutMs + 100)

    const runMsg: HostMsg = { kind: 'run', runId, code, scope, timeoutMs }
    w.postMessage(runMsg)
  })
}

function timedOutResult(timeoutMs: number, scope: SharedScope): RuntimeResult {
  const status: RuntimeStatus = 'timeout'
  const items: OutputItem[] = [{ type: 'stderr', text: `Execution timed out after ${timeoutMs}ms` }]
  return { status, items, scope }
}
