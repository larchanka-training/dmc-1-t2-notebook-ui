// Web Worker entrypoint. Owns a single persistent QuickJS kernel for the
// worker's lifetime, so shared scope between cells is just the kernel's own
// VM state. Receives HostMsg, runs code, posts WorkerMsg back.
//
// Not imported directly — workerHost references it via
// `new URL('./worker.ts', import.meta.url)`, which Vite (and
// @vitest/web-worker in tests) understands as "bundle this as a worker".

import { createKernel, type Kernel } from './quickjs'
import { isInterruptRequested, setInterruptBuffer } from './interrupt'
import type { HostMsg, WorkerMsg } from './types'

let kernelPromise: Promise<Kernel> | null = null

function getKernel(): Promise<Kernel> {
  if (!kernelPromise) kernelPromise = createKernel({ shouldInterrupt: isInterruptRequested })
  return kernelPromise
}

self.onmessage = async (event: MessageEvent<HostMsg>) => {
  const msg = event.data

  if (msg.kind === 'init') {
    // Host shares a SAB whose first int32 is the interrupt flag. The kernel's
    // interrupt handler reads it to abort a blocked VM (Stop / Stop All)
    // without destroying the VM, so the shared scope survives.
    setInterruptBuffer(msg.interruptBuffer)
    return
  }

  if (msg.kind !== 'run') return

  const { runId, code, timeoutMs } = msg
  try {
    const kernel = await getKernel()
    // Stream each item to the host the moment the kernel produces it (true
    // incremental output) instead of replaying the whole batch after the run
    // settles. The final result still carries the same items, but they have
    // already been posted, so we only send the terminal 'done' here.
    const result = await kernel.run(code, {
      timeoutMs,
      onItem: (item) => {
        const out: WorkerMsg = { kind: 'output', runId, item }
        self.postMessage(out)
      },
    })
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
