// Web Worker entrypoint. Receives HostMsg from workerHost, runs the code
// inside QuickJS, and posts WorkerMsg back. Not imported anywhere directly
// — workerHost references it via `new URL('./worker.ts', import.meta.url)`,
// which Vite (and @vitest/web-worker in tests) understands as "bundle this
// module as a worker entrypoint".

import { runInQuickJS } from './quickjs'
import type { HostMsg, WorkerMsg } from './types'

self.onmessage = async (event: MessageEvent<HostMsg>) => {
  const msg = event.data
  if (msg.kind !== 'run') return
  const { runId, code, scope, timeoutMs } = msg
  try {
    const result = await runInQuickJS(code, scope, { timeoutMs })
    // If QuickJS interrupt-handler fired (deadline-based), treat it as a
    // timeout for the caller — from the user's perspective there is no
    // difference between an in-VM interrupt and a host-side terminate.
    const looksLikeInterrupt = result.items.some(
      (it) => it.type === 'error' && /interrupt/i.test(it.message),
    )
    const finalStatus = result.status === 'error' && looksLikeInterrupt ? 'timeout' : result.status
    // Stream each output item before the final 'done' — keeps the host
    // protocol future-proof for streaming and matches WorkerMsg shape.
    for (const item of result.items) {
      const out: WorkerMsg = { kind: 'output', runId, item }
      self.postMessage(out)
    }
    const done: WorkerMsg = { kind: 'done', runId, status: finalStatus, scope: result.scope }
    self.postMessage(done)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const errItem: WorkerMsg = {
      kind: 'output',
      runId,
      item: { type: 'error', name: 'WorkerError', message },
    }
    self.postMessage(errItem)
    const done: WorkerMsg = { kind: 'done', runId, status: 'error', scope }
    self.postMessage(done)
  }
}

// Module scope marker (without this TS treats the file as a script).
export {}
