// Web Worker entrypoint. Owns a single persistent QuickJS kernel for the
// worker's lifetime, so shared scope between cells is just the kernel's own
// VM state. Receives HostMsg, runs code, posts WorkerMsg back.
//
// Not imported directly — workerHost references it via
// `new URL('./worker.ts', import.meta.url)`, which Vite (and
// @vitest/web-worker in tests) understands as "bundle this as a worker".

import { createKernel, type Kernel } from './quickjs'
import type { HostMsg, WorkerMsg } from './types'

let kernelPromise: Promise<Kernel> | null = null

function getKernel(): Promise<Kernel> {
  if (!kernelPromise) kernelPromise = createKernel()
  return kernelPromise
}

async function resetKernel(): Promise<void> {
  if (kernelPromise) {
    const kernel = await kernelPromise
    kernel.dispose()
  }
  kernelPromise = createKernel()
}

self.onmessage = async (event: MessageEvent<HostMsg>) => {
  const msg = event.data

  if (msg.kind === 'reset') {
    await resetKernel()
    return
  }

  if (msg.kind !== 'run') return

  const { runId, code, timeoutMs } = msg
  try {
    const kernel = await getKernel()
    const result = await kernel.run(code, { timeoutMs })
    // Stream each output item before the final 'done'.
    for (const item of result.items) {
      const out: WorkerMsg = { kind: 'output', runId, item }
      self.postMessage(out)
    }
    const done: WorkerMsg = { kind: 'done', runId, status: result.status }
    self.postMessage(done)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const errItem: WorkerMsg = {
      kind: 'output',
      runId,
      item: { type: 'error', name: 'WorkerError', message },
    }
    self.postMessage(errItem)
    const done: WorkerMsg = { kind: 'done', runId, status: 'error' }
    self.postMessage(done)
  }
}

// Module scope marker (without this TS treats the file as a script).
export {}
