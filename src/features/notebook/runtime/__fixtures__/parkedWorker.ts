// A `WorkerLike` that accepts a run and then parks forever, so the only way the
// in-flight run ever settles is the interrupt path (Stop / Stop All).
//
// Why this exists: the stop tests used to drive a REAL QuickJS worker executing
// `while(true){}`. That works, but it burns a CPU core until something terminates
// it, and vitest runs test files in parallel — so under `test:coverage` (v8
// instrumentation makes everything slower) a not-yet-terminated loop starves the
// event loop and times out whichever test is running next. That is exactly how
// `runtime.test.ts > stopAll leaves no resume trail` failed in CI at 30s against a
// 5s budget while passing locally and in the plain `pnpm test` run.
//
// A parked worker removes the hazard at the source: no loop, no CPU burn, and the
// stop path under test is unchanged — the host still has to issue the interrupt
// and resolve the run. It is also STRICTLY more deterministic, because
// `firstRun` resolves exactly when `workerHost` has posted the run message, which
// replaces the fragile "await two microtasks and hope the resolver is installed"
// dance.
//
// This does NOT reduce coverage of the real engine: the real interrupt/timeout
// paths are still exercised against a live worker in `quickjs.test.ts`,
// `workerHost.test.ts`, and the timeout test in `runtime.test.ts`.

import type { HostMsg, WorkerMsg } from '../types'
import type { WorkerLike } from '../workerHost'

export interface ParkedWorker {
  worker: WorkerLike
  /** Resolves once the host has actually posted a `run` message to this worker. */
  firstRun: Promise<void>
  /** True after the host terminated the worker (what Stop All must do). */
  terminated: () => boolean
}

export function createParkedWorker(): ParkedWorker {
  let resolveFirstRun: (() => void) | null = null
  let terminated = false
  const listeners: Array<(event: MessageEvent<WorkerMsg>) => void> = []
  const firstRun = new Promise<void>((resolve) => {
    resolveFirstRun = resolve
  })
  const worker: WorkerLike = {
    postMessage: (msg: HostMsg) => {
      if (msg.kind !== 'run') return
      if (terminated) {
        // A run that arrives AFTER Stop terminated this worker. In production
        // `ensureWorker` would have built a FRESH worker here, which answers; the
        // stub factory hands back the same dead object instead, so without this
        // branch the run gets no reply and sits until the host watchdog fires at
        // `timeoutMs + 100` (30100ms). That is precisely the ~30s hang seen in CI
        // three times — it was an artefact of this fixture, not of the product.
        // Answer immediately so the queue drains at test speed.
        const done: WorkerMsg = { kind: 'done', runId: msg.runId, status: 'interrupted' }
        queueMicrotask(() => {
          for (const listener of [...listeners]) {
            listener({ data: done } as MessageEvent<WorkerMsg>)
          }
        })
        return
      }
      resolveFirstRun?.()
      resolveFirstRun = null
      // Park: the FIRST run can only end through requestInterrupt.
    },
    addEventListener: (_type, listener) => {
      listeners.push(listener)
    },
    removeEventListener: (_type, listener) => {
      const i = listeners.indexOf(listener)
      if (i >= 0) listeners.splice(i, 1)
    },
    terminate: () => {
      terminated = true
      listeners.length = 0
    },
  }
  return { worker, firstRun, terminated: () => terminated }
}

/**
 * Budget for the stop/queue tests.
 *
 * History, because the number moved twice for the wrong reason:
 *   - the tests failed in CI at ~30013ms, ~30079ms and ~30016ms against budgets
 *     of 5000ms and then 20000ms. Three hangs landing on the same ~30.0s is not
 *     the scatter CPU starvation produces;
 *   - ~30100ms is exactly the host watchdog (`timeoutMs + 100`), so the run was
 *     waiting for that watchdog, not for CPU. Raising the budget could never fix
 *     it, and did not;
 *   - the cause was in THIS fixture: after Stop terminated the parked worker, the
 *     stub factory handed the same dead object to the next queued run, which
 *     therefore got no reply. `createParkedWorker` now answers post-termination
 *     runs immediately, which is what a real fresh worker would do.
 *
 * With no path that can reach the watchdog, a tight budget is meaningful again:
 * these tests settle in milliseconds, so anything near a second means the stop
 * path genuinely broke. Keep it small — a large budget here would only hide the
 * next real hang.
 */
export const STOP_TEST_TIMEOUT_MS = 5_000
