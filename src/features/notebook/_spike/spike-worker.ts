// SPIKE — TARDIS-70. Web Worker entrypoint. Receives { code, timeoutMs }
// and sends back the SmokeResult from runSmoke().
import { runSmoke, type SmokeResult } from './quickjs-smoke'

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

self.onmessage = async (event: MessageEvent<RunMsg>) => {
  const { runId, code, timeoutMs } = event.data
  try {
    const result = await runSmoke(code, timeoutMs)
    const reply: DoneMsg = { kind: 'done', runId, result }
    self.postMessage(reply)
  } catch (err) {
    const reply: DoneMsg = {
      kind: 'done',
      runId,
      result: {
        ok: false,
        output: `worker exception: ${err instanceof Error ? err.message : String(err)}`,
        isolation: { window: '?', document: '?', fetch: '?', localStorage: '?' },
      },
    }
    self.postMessage(reply)
  }
}

export {} // ensure module scope
