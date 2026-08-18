// Epic 01 — Acceptance Traceability for Stop / Stop All / Restart Kernel.
// Lives in its own file (own vitest worker process) because mixing these
// scenarios with the rest of the suite trips a @vitest/web-worker
// teardown quirk.

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { addCell, cellsAtom, deleteCell, updateCellCode } from '../model/notebook'
import { queueAtom, restartKernel, runAll, runCell, stopAll, stopCell } from '../model/runtime'
import type { HostMsg, WorkerMsg } from './types'
import { restartWorker, setWorkerFactory, type WorkerLike } from './workerHost'

beforeEach(async () => {
  restartKernel()
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

function createParkedWorker(): {
  worker: WorkerLike
  firstRun: Promise<void>
  terminated: () => boolean
} {
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
      // Park forever: Stop All must resolve the in-flight run via requestInterrupt.
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

describe('Epic 01 AC — Stop', () => {
  test('AC: stopCell interrupts a running cell quickly with a stderr note', async () => {
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'while(true){}')
    const promise = runCell(cell.id)
    await Promise.resolve()
    await Promise.resolve()
    const start = Date.now()
    stopCell(cell.id)
    await promise
    const elapsed = Date.now() - start
    expect(cell.status()).toBe('interrupted')
    expect(elapsed).toBeLessThan(500)
    expect(cell.output().some((it) => it.type === 'stderr' && /interrupt/i.test(it.text))).toBe(
      true,
    )
  }, 5000)

  test('AC: stopAll halts the queue and clears pending cells', async () => {
    const fake = createParkedWorker()
    const restore = setWorkerFactory(() => fake.worker)
    const [a] = cellsAtom()
    const b = addCell()
    const c = addCell()
    try {
      updateCellCode(a.id, 'parked-a')
      updateCellCode(b.id, 'console.log("b")')
      updateCellCode(c.id, 'console.log("c")')
      const promise = runAll()
      await fake.firstRun
      expect(a.status()).toBe('running')
      expect(queueAtom()).toEqual([b.id, c.id])

      stopAll()
      await promise

      expect(fake.terminated()).toBe(true)
      expect(a.status()).toBe('interrupted')
      expect(a.output().some((it) => it.type === 'stderr' && /interrupt/i.test(it.text))).toBe(true)
      expect(b.executionCount()).toBe(null)
      expect(c.executionCount()).toBe(null)
      expect(queueAtom()).toEqual([])
    } finally {
      restore()
    }
  }, 5000)
})

// Restart-kernel scenarios live in runtime.acceptance.restart.test.ts to
// give them their own vitest worker process; mixing them with stopAll
// inside the same file trips a @vitest/web-worker teardown quirk.
