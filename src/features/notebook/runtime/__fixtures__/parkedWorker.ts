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
      resolveFirstRun?.()
      resolveFirstRun = null
      // Park forever: the run can only end through requestInterrupt.
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
 * Timeout budget for stop/queue tests that assert BOOKKEEPING rather than latency.
 *
 * These tests do not measure how fast anything is, so the default 5000ms was
 * asserting nothing about the product — it was only measuring how loaded the
 * machine happened to be. CI is a 2-core `ubuntu-latest`, `test:coverage` adds v8
 * instrumentation, and other files still spin real infinite loops in parallel
 * (`quickjs.test.ts` alone runs three `while(true)` cases with 60s kernel
 * timeouts), so a file can go seconds without CPU. That starvation is CROSS-FILE:
 * making one file stop burning CPU does not protect it from the others.
 *
 * The value stays BELOW the host watchdog (`timeoutMs + 100` = 30100ms) on
 * purpose: a genuinely hung run must still fail these tests rather than be
 * rescued by the watchdog and pass.
 *
 * CAVEAT, recorded honestly: both observed CI hangs measured ~30.0-30.1s, which is
 * suspiciously exactly that host watchdog. If a hang is the run waiting for the
 * watchdog rather than the file waiting for CPU, then NO budget below 30.1s can
 * make it pass, and this constant is not the fix. Treat a recurrence at ~30s as
 * evidence for that second explanation, not as a reason to raise the number.
 */
export const STARVATION_TOLERANT_MS = 20_000
