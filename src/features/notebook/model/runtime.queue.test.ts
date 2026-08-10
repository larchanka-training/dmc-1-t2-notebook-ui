import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { addCell, cellsAtom, deleteCell, updateCellCode } from './notebook'
import { queueAtom, restartKernel, runAll, stopCell } from './runtime'
import { restartWorker, setWorkerFactory, type WorkerLike } from '../runtime/workerHost'
import type { HostMsg, RuntimeStatus, WorkerMsg } from '../runtime/types'

// This queue-isolation test lives in its OWN file on purpose. It drives the
// scheduler through an inline, fully-controllable `WorkerLike` (no real QuickJS,
// no `@vitest/web-worker`), so it is deterministic on its own. But the
// stop/timeout tests in `runtime.test.ts` run REAL workers executing `while(true)`
// loops; under full-suite load a not-yet-terminated loop can starve the shared
// event loop and time out whichever test runs next. Splitting this test out gives
// it its own vitest worker, immune to that contention — the same reasoning that
// put the restartKernel group in `runtime.restart.test.ts`.

beforeEach(async () => {
  restartKernel()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  const ids = cellsAtom().map((c) => c.id)
  for (let i = 1; i < ids.length; i++) deleteCell(ids[i])
  const [first] = cellsAtom()
  first.code.set('')
})

afterEach(async () => {
  restartWorker()
  for (let i = 0; i < 5; i++) await Promise.resolve()
})

/**
 * An inline `WorkerLike` with an explicit completion gate. It ACCEPTS a run
 * (recording the `postMessage` and its `runId`) but does not reply until the test
 * calls `complete(runId)` — modelling a cell held in flight, then finished on
 * demand. `workerHost.runOne` sends the `run` message only AFTER registering its
 * message handler, so `firstRun` resolving is a deterministic proof the run is
 * genuinely in flight (no polling, no registration race), and `complete()` ends it
 * WITHOUT any Stop / interrupt / terminate path — so the test never depends on the
 * SAB watchdog or `restartWorker` cleanup.
 */
function createControllableWorker(): {
  worker: WorkerLike
  state: { terminated: boolean; runs: number; lastRunId: string | null }
  firstRun: Promise<void>
  complete: (runId: string, status?: RuntimeStatus) => void
} {
  const listeners: Array<(event: MessageEvent<WorkerMsg>) => void> = []
  const state = { terminated: false, runs: 0, lastRunId: null as string | null }
  let signalFirstRun: (() => void) | null = null
  const firstRun = new Promise<void>((resolve) => {
    signalFirstRun = resolve
  })
  const worker: WorkerLike = {
    postMessage: (msg: HostMsg) => {
      if (msg.kind !== 'run') return
      state.runs += 1
      state.lastRunId = msg.runId
      signalFirstRun?.()
      signalFirstRun = null
      // Hold: the run stays in flight until the test calls `complete(runId)`.
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
  const complete = (runId: string, status: RuntimeStatus = 'done') => {
    const done: WorkerMsg = { kind: 'done', runId, status }
    for (const listener of [...listeners]) listener({ data: done } as MessageEvent<WorkerMsg>)
  }
  return { worker, state, firstRun, complete }
}

describe('queue scheduling (controllable worker)', () => {
  test('stopCell on a queued (not running) cell drops it without killing the running one', async () => {
    const fake = createControllableWorker()
    const restore = setWorkerFactory(() => fake.worker)
    try {
      // Two cells only: `a` runs, `c` waits behind it in the queue.
      const [a] = cellsAtom()
      const c = addCell()
      // Code content is irrelevant — the injected worker controls run completion.
      updateCellCode(a.id, 'noop-a')
      updateCellCode(c.id, 'noop-c')
      const promise = runAll()
      // Deterministic gate: `a`'s run reached the worker, and workerHost sends
      // that message only AFTER registering its handler — so `a` is genuinely in
      // flight and `c` is queued behind it.
      await fake.firstRun
      expect(a.status()).toBe('running')
      expect(fake.state.runs).toBe(1) // only a was dispatched; c waits in queue
      expect(queueAtom()).toContain(c.id)

      // The behaviour under test: stopping the QUEUED c drops it WITHOUT touching
      // the worker (which would kill the running a).
      stopCell(c.id)
      expect(queueAtom()).not.toContain(c.id)
      expect(c.status()).toBe('idle')
      expect(a.status()).toBe('running') // a untouched
      expect(fake.state.terminated).toBe(false) // the worker was NOT terminated

      // Finish the run the normal way — a `done` reply for a — so the queue drains
      // and `runAll` resolves. No Stop All, no interrupt watchdog, no restartWorker.
      fake.complete(fake.state.lastRunId!, 'done')
      await promise
      expect(a.status()).toBe('done')
      expect(fake.state.terminated).toBe(false)
      expect(c.executionCount()).toBe(null) // c was dropped, never ran
    } finally {
      restore()
    }
  }, 5000)
})
