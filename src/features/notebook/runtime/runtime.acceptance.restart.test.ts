// Epic 01 — Acceptance Traceability for Restart Kernel.
// Own vitest worker process — see runtime.acceptance.stop.test.ts for
// the same rationale.

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { addCell, cellsAtom, deleteCell, updateCellCode } from '../model/notebook'
import { execCounterAtom, queueAtom, restartKernel, runCell } from '../model/runtime'
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

describe('Epic 01 AC — Restart Kernel', () => {
  test('AC: restartKernel clears shared scope, execCounter, queue, and per-cell state', async () => {
    const [a] = cellsAtom()
    const b = addCell()
    updateCellCode(a.id, 'const survives = 1')
    updateCellCode(b.id, 'console.log(survives)')
    await runCell(a.id)
    await runCell(b.id)
    expect(execCounterAtom()).toBe(2)
    // Shared scope lives in the worker VM; observe it through cell B output.
    expect(b.output()).toContainEqual({ type: 'stdout', text: '1' })

    restartKernel()

    expect(execCounterAtom()).toBe(0)
    expect(queueAtom()).toEqual([])
    expect(a.executionCount()).toBe(null)
    expect(b.executionCount()).toBe(null)
    expect(a.status()).toBe('idle')
  })

  test('AC: after restartKernel, previously-defined variables are gone', async () => {
    const [a] = cellsAtom()
    const b = addCell()
    updateCellCode(a.id, 'const willClear = 5')
    updateCellCode(b.id, 'console.log(typeof willClear)')
    await runCell(a.id)
    restartKernel()
    await runCell(b.id)
    expect(b.output()).toContainEqual({ type: 'stdout', text: 'undefined' })
  })
})
