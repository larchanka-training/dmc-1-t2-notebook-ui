// Epic 01 — Acceptance Traceability for Stop / Stop All / Restart Kernel.
// Lives in its own file (own vitest worker process) because mixing these
// scenarios with the rest of the suite trips a @vitest/web-worker
// teardown quirk.

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { addCell, cellsAtom, deleteCell, updateCellCode } from '../model/notebook'
import { queueAtom, restartKernel, runAll, runCell, stopAll, stopCell } from '../model/runtime'
import { restartWorker, setWorkerFactory } from './workerHost'
// Shared with `model/runtime.test.ts`, which switched its stopAll tests onto the
// same parked worker to remove a real `while(true)` flake.
import { createParkedWorker, STARVATION_TOLERANT_MS } from './__fixtures__/parkedWorker'

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

describe('Epic 01 AC — Stop', () => {
  test(
    'AC: stopCell interrupts a running cell quickly with a stderr note',
    async () => {
      // Parked, not a real `while(true)`: this was the LAST real infinite loop in
      // the file, and it sat immediately before the parked test that hung for ~30s
      // in CI — a far more proximate suspect than another file. The AC being
      // traced here is "Stop interrupts promptly and leaves a stderr note", which
      // the host's own stop path provides; the real QuickJS interrupt is covered
      // against a live engine in `quickjs.test.ts` and `workerHost.test.ts`.
      const fake = createParkedWorker()
      const restore = setWorkerFactory(() => fake.worker)
      const [cell] = cellsAtom()
      updateCellCode(cell.id, 'parked-cell')
      const promise = runCell(cell.id)
      await fake.firstRun
      const start = Date.now()
      stopCell(cell.id)
      await promise
      restore()
      const elapsed = Date.now() - start
      expect(cell.status()).toBe('interrupted')
      expect(elapsed).toBeLessThan(500)
      expect(cell.output().some((it) => it.type === 'stderr' && /interrupt/i.test(it.text))).toBe(
        true,
      )
    },
    STARVATION_TOLERANT_MS,
  )

  test(
    'AC: stopAll halts the queue and clears pending cells',
    async () => {
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
        expect(a.output().some((it) => it.type === 'stderr' && /interrupt/i.test(it.text))).toBe(
          true,
        )
        expect(b.executionCount()).toBe(null)
        expect(c.executionCount()).toBe(null)
        expect(queueAtom()).toEqual([])
      } finally {
        restore()
      }
    },
    STARVATION_TOLERANT_MS,
  )
})

// Restart-kernel scenarios live in runtime.acceptance.restart.test.ts to
// give them their own vitest worker process; mixing them with stopAll
// inside the same file trips a @vitest/web-worker teardown quirk.
