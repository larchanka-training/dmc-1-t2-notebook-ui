// SPIKE — TARDIS-70. Host facade for the spike worker. Singleton worker,
// timeout via terminate + respawn.
import type { SmokeResult } from './quickjs-smoke'

interface RunMsg {
  kind: 'run'
  runId: string
  code: string
  timeoutMs: number
}

interface DoneMsg {
  kind: 'done'
  runId: string
  result: SmokeResult
}

let worker: Worker | null = null

function ensureWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./spike-worker.ts', import.meta.url), { type: 'module' })
  return worker
}

function nextRunId(): string {
  return Math.random().toString(36).slice(2)
}

export async function runInSpikeWorker(code: string, timeoutMs = 1000): Promise<SmokeResult> {
  const w = ensureWorker()
  const runId = nextRunId()

  return new Promise<SmokeResult>((resolve) => {
    const timer = setTimeout(() => {
      w.removeEventListener('message', onMessage)
      w.terminate()
      worker = null
      resolve({
        ok: false,
        output: `host: terminated by timeout after ${timeoutMs}ms`,
        isolation: { window: '?', document: '?', fetch: '?', localStorage: '?' },
        timedOut: true,
      })
    }, timeoutMs + 100) // host timeout slightly above worker-side deadline

    const onMessage = (event: MessageEvent<DoneMsg>) => {
      if (event.data.runId !== runId) return
      clearTimeout(timer)
      w.removeEventListener('message', onMessage)
      resolve(event.data.result)
    }
    w.addEventListener('message', onMessage)

    const msg: RunMsg = { kind: 'run', runId, code, timeoutMs }
    w.postMessage(msg)
  })
}
