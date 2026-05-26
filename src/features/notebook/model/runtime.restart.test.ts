// Restart-kernel scenarios live in their own file to keep them in their
// own vitest worker process — sharing a worker with stopCell/stopAll
// causes @vitest/web-worker to hang on pending RPC during teardown.

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { addCell, cellsAtom, deleteCell, sharedScopeAtom, updateCellCode } from './notebook'
import { execCounterAtom, queueAtom, restartKernel, runCell } from './runtime'
import { restartWorker } from '../runtime/workerHost'

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

describe('restartKernel', () => {
  test('resets execCounter, shared scope, queue, and per-cell run state', async () => {
    const [a] = cellsAtom()
    const b = addCell()
    updateCellCode(a.id, 'const survives = 1')
    updateCellCode(b.id, 'console.log(survives)')
    await runCell(a.id)
    await runCell(b.id)

    expect(execCounterAtom()).toBe(2)
    expect(sharedScopeAtom()).toEqual({ survives: 1 })

    restartKernel()

    expect(execCounterAtom()).toBe(0)
    expect(sharedScopeAtom()).toEqual({})
    expect(queueAtom()).toEqual([])
    expect(a.status()).toBe('idle')
    expect(b.status()).toBe('idle')
    expect(a.executionCount()).toBe(null)
    expect(b.executionCount()).toBe(null)
    expect(a.output()).toEqual([])
  })

  test('shared scope is cleared so previous variables become undefined', async () => {
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
