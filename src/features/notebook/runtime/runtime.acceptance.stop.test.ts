// Epic 01 — Acceptance Traceability for Stop / Stop All / Restart Kernel.
// Lives in its own file (own vitest worker process) because mixing these
// scenarios with the rest of the suite trips a @vitest/web-worker
// teardown quirk.

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { addCell, cellsAtom, deleteCell, updateCellCode } from '../model/notebook'
import { queueAtom, restartKernel, runAll, runCell, stopAll, stopCell } from '../model/runtime'
import { restartWorker } from './workerHost'

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
    const [a] = cellsAtom()
    const b = addCell()
    const c = addCell()
    updateCellCode(a.id, 'while(true){}')
    updateCellCode(b.id, 'console.log("b")')
    updateCellCode(c.id, 'console.log("c")')
    const promise = runAll()
    await Promise.resolve()
    await Promise.resolve()
    stopAll()
    await promise
    expect(a.status()).toBe('interrupted')
    expect(b.executionCount()).toBe(null)
    expect(c.executionCount()).toBe(null)
    expect(queueAtom()).toEqual([])
  }, 5000)
})

// Restart-kernel scenarios live in runtime.acceptance.restart.test.ts to
// give them their own vitest worker process; mixing them with stopAll
// inside the same file trips a @vitest/web-worker teardown quirk.
