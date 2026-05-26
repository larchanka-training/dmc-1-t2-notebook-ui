import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { addCell, cellsAtom, deleteCell, updateCellCode } from './notebook'
import {
  queueAtom,
  restartKernel,
  resumeQueue,
  runAll,
  runCell,
  runtimeStatusAtom,
  skippedCellsAtom,
  stopAll,
  stopCell,
} from './runtime'
import { DEFAULT_TIMEOUT_MS, timeoutMsAtom } from './notebookSettings'
import { restartWorker } from '../runtime/workerHost'

beforeEach(async () => {
  // Reset cross-test state via the proper public action, then prune any
  // extra cells left over from a previous test. The microtask flush
  // below drains any in-flight `runInWorker` that was interrupted by the
  // restartKernel — it resolved as 'interrupted', and we need its
  // continuation (mapStatus / cell.status.set) to settle before the
  // test body runs.
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
  // Let any pending microtasks finish (e.g. an executeCell that was
  // unstuck by restartWorker still has continuation work to do).
  for (let i = 0; i < 5; i++) await Promise.resolve()
})

describe('runCell', () => {
  test('drives running → done and stamps executionCount', async () => {
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'console.log("answer", 42)')
    expect(cell.executionCount()).toBe(null)
    const promise = runCell(cell.id)
    expect(cell.status()).toBe('running')
    await promise
    expect(cell.status()).toBe('done')
    expect(cell.executionCount()).toBe(1)
    expect(cell.output()).toContainEqual({ type: 'stdout', text: 'answer 42' })
  })

  test('sets status=error and still stamps executionCount on throw', async () => {
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'throw new Error("nope")')
    await runCell(cell.id)
    expect(cell.status()).toBe('error')
    expect(cell.executionCount()).toBe(1)
  })

  test('no-op on unknown id', async () => {
    await expect(runCell('does-not-exist')).resolves.toBeUndefined()
  })

  test('editing code does NOT reset executionCount', async () => {
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'console.log("first")')
    await runCell(cell.id)
    expect(cell.executionCount()).toBe(1)
    updateCellCode(cell.id, 'console.log("edited")')
    expect(cell.executionCount()).toBe(1)
  })
})

describe('runCell — shared scope', () => {
  test('var from cell A is visible in cell B', async () => {
    const [a] = cellsAtom()
    const b = addCell()
    updateCellCode(a.id, 'var shared = 7')
    updateCellCode(b.id, 'console.log(shared)')
    await runCell(a.id)
    await runCell(b.id)
    expect(b.output()).toContainEqual({ type: 'stdout', text: '7' })
  })

  test('deleting a cell does NOT remove its variables from scope', async () => {
    const [a] = cellsAtom()
    const b = addCell()
    updateCellCode(a.id, 'const persisted = 99')
    updateCellCode(b.id, 'console.log(persisted)')
    await runCell(a.id)
    deleteCell(a.id)
    await runCell(b.id)
    expect(b.output()).toContainEqual({ type: 'stdout', text: '99' })
  })
})

describe('runAll', () => {
  test('runs every code cell in order, executionCount increments monotonically', async () => {
    const [a] = cellsAtom()
    const b = addCell()
    const c = addCell()
    updateCellCode(a.id, 'console.log("a")')
    updateCellCode(b.id, 'console.log("b")')
    updateCellCode(c.id, 'console.log("c")')

    await runAll()

    expect(a.status()).toBe('done')
    expect(b.status()).toBe('done')
    expect(c.status()).toBe('done')
    expect(a.executionCount()).toBe(1)
    expect(b.executionCount()).toBe(2)
    expect(c.executionCount()).toBe(3)
    expect(queueAtom()).toEqual([])
    expect(runtimeStatusAtom()).toBe('idle')
  }, 10_000)

  test('error in the middle skips the remaining cells', async () => {
    const [a] = cellsAtom()
    const b = addCell()
    const c = addCell()
    updateCellCode(a.id, 'console.log("a")')
    updateCellCode(b.id, 'throw new Error("middle")')
    updateCellCode(c.id, 'console.log("c")')

    await runAll()

    expect(a.status()).toBe('done')
    expect(b.status()).toBe('error')
    expect(c.status()).toBe('skipped')
    expect(c.executionCount()).toBe(null) // never ran
  })
})

describe('notebookSettings.timeoutMs', () => {
  test('default is 30 s', () => {
    expect(timeoutMsAtom()).toBe(DEFAULT_TIMEOUT_MS)
    expect(DEFAULT_TIMEOUT_MS).toBe(30_000)
  })

  test('a short user-set timeout interrupts an infinite loop quickly', async () => {
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'while(true){}')
    timeoutMsAtom.set(200)
    try {
      const start = Date.now()
      await runCell(cell.id)
      const elapsed = Date.now() - start
      expect(cell.status()).toBe('error')
      expect(elapsed).toBeLessThan(1000)
    } finally {
      timeoutMsAtom.set(DEFAULT_TIMEOUT_MS)
    }
  }, 5000)
})

describe('resumeQueue (continue from skipped)', () => {
  test('after an error in the middle, resumeQueue runs the skipped cells', async () => {
    const [a] = cellsAtom()
    const b = addCell()
    const c = addCell()
    updateCellCode(a.id, 'console.log("a")')
    updateCellCode(b.id, 'throw new Error("middle")')
    updateCellCode(c.id, 'console.log("c")')

    await runAll()
    expect(c.status()).toBe('skipped')
    expect(skippedCellsAtom()).toEqual([c.id])

    // Fix the broken cell so the queue can progress.
    updateCellCode(b.id, 'console.log("b-fixed")')
    // Resume picks up only what was skipped — does NOT re-run b.
    await resumeQueue()
    expect(c.status()).toBe('done')
    expect(c.output()).toContainEqual({ type: 'stdout', text: 'c' })
    // skippedCellsAtom is drained after a successful resume.
    expect(skippedCellsAtom()).toEqual([])
  }, 10_000)

  test('runAll clears any previous skipped list before scheduling', async () => {
    const [a] = cellsAtom()
    const b = addCell()
    updateCellCode(a.id, 'throw new Error("boom")')
    updateCellCode(b.id, 'console.log("b")')
    await runAll()
    expect(skippedCellsAtom()).toEqual([b.id])

    // Fix a, run again — the previous skipped trail must be gone.
    updateCellCode(a.id, 'console.log("a")')
    await runAll()
    expect(skippedCellsAtom()).toEqual([])
  }, 10_000)

  test('resumeQueue is a no-op when there is nothing skipped', async () => {
    expect(skippedCellsAtom()).toEqual([])
    await resumeQueue() // must not throw, must not block
    expect(skippedCellsAtom()).toEqual([])
  })
})

describe('stopCell / stopAll', () => {
  test('stopCell on a running cell yields interrupted status', async () => {
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'while(true){}')
    const promise = runCell(cell.id)
    // Yield to the microtask queue so runInWorker enters runOne and
    // installs the inFlightResolver before we call stopCell.
    await Promise.resolve()
    await Promise.resolve()
    stopCell(cell.id)
    await promise
    expect(cell.status()).toBe('interrupted')
    // explicit stderr item with the interruption message
    expect(cell.output().some((it) => it.type === 'stderr' && /interrupt/i.test(it.text))).toBe(
      true,
    )
  }, 5000)

  test('stopAll halts the queue and marks remaining cells as skipped', async () => {
    const [a] = cellsAtom()
    const b = addCell()
    const c = addCell()
    updateCellCode(a.id, 'while(true){}')
    updateCellCode(b.id, 'console.log("b")')
    updateCellCode(c.id, 'console.log("c")')

    const promise = runAll()
    // Microtask yield to let runAll's first executeCell install the resolver.
    await Promise.resolve()
    await Promise.resolve()
    stopAll()
    await promise

    expect(a.status()).toBe('interrupted')
    // b and c never ran — either skipped (we noticed before they came up)
    // or idle (queue was drained before their turn). Both are acceptable
    // outcomes; the strict guarantee is they did NOT run.
    expect(['skipped', 'idle']).toContain(b.status())
    expect(['skipped', 'idle']).toContain(c.status())
    expect(b.executionCount()).toBe(null)
    expect(c.executionCount()).toBe(null)
    expect(queueAtom()).toEqual([])
  }, 5000)
})

// restartKernel scenarios live in `runtime.restart.test.ts` — they share
// worker / scope state with stopCell/stopAll in subtle ways that the
// @vitest/web-worker shim handles poorly when both groups run in the
// same file. Splitting the file gives each group its own vitest worker.
