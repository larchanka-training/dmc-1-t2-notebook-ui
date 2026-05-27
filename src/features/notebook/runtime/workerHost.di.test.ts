// Verifies the workerHost DI hook: a fake worker that synchronously
// echoes a `done` message must drive runInWorker without touching
// quickjs-emscripten or @vitest/web-worker. The point is to give future
// tests a fast, deterministic path that mirrors the epic's "synchronous
// inline-host" suggestion.

import { describe, expect, test } from 'vitest'
import type { HostMsg, WorkerMsg } from './types'
import { requestInterrupt, runInWorker, setWorkerFactory, type WorkerLike } from './workerHost'

/**
 * Build an inline worker that captures listeners and lets the test drive
 * worker→host messages synchronously via `dispatch`. Mirrors the minimum
 * `WorkerLike` surface workerHost needs.
 */
function createFakeWorker(handleRun: (msg: HostMsg & { kind: 'run' }) => WorkerMsg[]): {
  worker: WorkerLike
  terminated: boolean
} {
  const listeners: Array<(event: MessageEvent<WorkerMsg>) => void> = []
  const state = { terminated: false }
  const worker: WorkerLike = {
    postMessage: (msg: HostMsg) => {
      if (msg.kind !== 'run') return
      const replies = handleRun(msg)
      // Microtask schedule mimics real postMessage ordering.
      queueMicrotask(() => {
        for (const reply of replies) {
          for (const l of listeners) l({ data: reply } as MessageEvent<WorkerMsg>)
        }
      })
    },
    addEventListener: (_type, listener) => {
      listeners.push(listener)
    },
    removeEventListener: (_type, listener) => {
      const i = listeners.indexOf(listener)
      if (i >= 0) listeners.splice(i, 1)
    },
    terminate: () => {
      state.terminated = true
      listeners.length = 0
    },
  }
  return { worker, terminated: state.terminated }
}

describe('workerHost — DI via setWorkerFactory', () => {
  test('routes through an inline WorkerLike without quickjs / web-worker shim', async () => {
    const fake = createFakeWorker((msg) => [
      { kind: 'output', runId: msg.runId, item: { type: 'stdout', text: 'fake-out' } },
      { kind: 'done', runId: msg.runId, status: 'done' },
    ])
    const restore = setWorkerFactory(() => fake.worker)
    try {
      const r = await runInWorker('console.log("ignored by fake")')
      expect(r.status).toBe('done')
      expect(r.items).toContainEqual({ type: 'stdout', text: 'fake-out' })
    } finally {
      restore()
    }
  })

  test('onItem streams each output item before the run resolves', async () => {
    const fake = createFakeWorker((msg) => [
      { kind: 'output', runId: msg.runId, item: { type: 'stdout', text: 'one' } },
      { kind: 'output', runId: msg.runId, item: { type: 'stdout', text: 'two' } },
      { kind: 'done', runId: msg.runId, status: 'done' },
    ])
    const restore = setWorkerFactory(() => fake.worker)
    const streamed: string[] = []
    try {
      const r = await runInWorker('whatever', {
        onItem: (item) => {
          if (item.type === 'stdout') streamed.push(item.text)
        },
      })
      // Callback saw items in order, and the final result carries the same set.
      expect(streamed).toEqual(['one', 'two'])
      expect(r.items).toEqual([
        { type: 'stdout', text: 'one' },
        { type: 'stdout', text: 'two' },
      ])
    } finally {
      restore()
    }
  })

  test('host budget triggers terminate on the injected worker too', async () => {
    let terminated = false
    const restore = setWorkerFactory(() => ({
      postMessage: (msg: HostMsg) => {
        if (msg.kind !== 'run') return
        // Flood the host with too much output to trip OUTPUT_BUDGET_BYTES.
        queueMicrotask(() => {
          const big = 'x'.repeat(1024 * 1024)
          for (let i = 0; i < 10; i++) {
            for (const l of listeners) {
              l({
                data: { kind: 'output', runId: msg.runId, item: { type: 'stdout', text: big } },
              } as MessageEvent<WorkerMsg>)
            }
          }
        })
      },
      addEventListener: (_t, l) => {
        listeners.push(l)
      },
      removeEventListener: (_t, l) => {
        const i = listeners.indexOf(l)
        if (i >= 0) listeners.splice(i, 1)
      },
      terminate: () => {
        terminated = true
      },
    }))
    const listeners: Array<(event: MessageEvent<WorkerMsg>) => void> = []
    try {
      const r = await runInWorker('whatever', { timeoutMs: 60_000 })
      expect(r.status).toBe('error')
      expect(terminated).toBe(true)
    } finally {
      restore()
    }
  }, 5000)

  test('requestInterrupt promptly stops a run that never replies (Stop fallback)', async () => {
    // A worker that accepts the run but never posts `done` models code parked
    // in a pending promise. Without a SAB (jsdom is not cross-origin
    // isolated) Stop must fall back to terminate so the run resolves quickly
    // as `interrupted`, well under the host timeout.
    let terminated = false
    const restore = setWorkerFactory(() => ({
      postMessage: (msg: HostMsg) => void msg,
      addEventListener: () => {},
      removeEventListener: () => {},
      terminate: () => {
        terminated = true
      },
    }))
    try {
      const run = runInWorker('await new Promise(() => {})', { timeoutMs: 60_000 })
      await Promise.resolve()
      const start = Date.now()
      requestInterrupt()
      const r = await run
      expect(Date.now() - start).toBeLessThan(500)
      expect(r.status).toBe('interrupted')
      expect(terminated).toBe(true)
    } finally {
      restore()
    }
  }, 5000)
})
