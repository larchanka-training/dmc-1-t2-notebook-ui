// Regression for P1: runtime actions must keep `runtimeStatusAtom` consistent
// across their internal `await` boundaries.
//
// In production `src/setup.ts` calls `clearStack()`, which disables Reatom's
// implicit global-context fallback: any atom write in an async continuation
// that isn't re-bound with `wrap` throws `missing async stack`, leaving the
// toolbar stuck at 'busy'. The shared test setup does NOT enable clearStack()
// (it would break every direct-atom-access test in the suite), so this file
// emulates the production invariant *per call*:
//
//   1. capture a `wrap`-ped handler inside a real context frame (= render time);
//   2. clearStack() to empty the global stack (= production at rest);
//   3. invoke the handler (= a later DOM event) — its async continuation now
//      runs with an empty stack, exactly like production. Without the
//      `await wrap(...)` fix in runtime.ts the continuation throws and the
//      status stays 'busy'.
//
// `clearStack()` leaves the global stack empty, so the shared `context.reset()`
// beforeEach would throw on the next test — afterEach re-seeds one root frame.
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { clearStack, context, STACK, wrap } from '@reatom/core'
import { addCell, cellsAtom, deleteCell, updateCellCode } from './notebook'
import {
  resumeQueue,
  restartKernel,
  runAll,
  runCell,
  runtimeStatusAtom,
  skippedCellsAtom,
} from './runtime'

let frame: ReturnType<typeof context.start>

beforeEach(() => {
  // Fresh isolated context per test → clean atom state (seed notebook).
  frame = context.start()
  frame.run(() => restartKernel())
  const ids = frame.run(() => cellsAtom().map((c) => c.id))
  for (let i = 1; i < ids.length; i++) frame.run(() => deleteCell(ids[i]))
  frame.run(() => cellsAtom()[0].code.set(''))
})

afterEach(() => {
  // Re-seed the global stack emptied by clearStack() so the shared
  // `context.reset()` in src/test/setup.ts (it calls top()) doesn't throw.
  if (STACK.length === 0) STACK.push(context.start())
})

/**
 * Fire an action the way a wrapped React handler does: capture context at
 * "render time" (inside the frame) via `wrap`, then empty the global stack and
 * invoke "later" (event time). This is the boundary that throws
 * `missing async stack` if the action drops context after an await.
 */
function fireLikeProd<T>(fn: () => T): T {
  const handler = frame.run(() => wrap(fn))
  clearStack()
  return handler()
}

async function settle(value: unknown): Promise<unknown> {
  let threw: unknown = null
  await Promise.resolve(value).catch((e) => {
    threw = e
  })
  return threw
}

describe('runtime async-stack safety (production clearStack)', () => {
  test('runCell returns the kernel to idle without throwing', async () => {
    const id = frame.run(() => {
      const [cell] = cellsAtom()
      updateCellCode(cell.id, 'console.log(1)')
      return cell.id
    })
    const threw = await settle(fireLikeProd(() => runCell(id)))
    expect(threw && String(threw)).toBe(null)
    expect(frame.run(() => runtimeStatusAtom())).toBe('idle')
  }, 15000)

  test('runAll returns the kernel to idle without throwing', async () => {
    frame.run(() => {
      const [a] = cellsAtom()
      updateCellCode(a.id, 'console.log("a")')
      const b = addCell()
      updateCellCode(b.id, 'console.log("b")')
    })
    const threw = await settle(fireLikeProd(() => runAll()))
    expect(threw && String(threw)).toBe(null)
    expect(frame.run(() => runtimeStatusAtom())).toBe('idle')
  }, 15000)

  test('resumeQueue after a skip returns the kernel to idle without throwing', async () => {
    const ids = frame.run(() => {
      const [a] = cellsAtom()
      updateCellCode(a.id, 'throw new Error("boom")')
      const b = addCell()
      updateCellCode(b.id, 'console.log("b")')
      return { a: a.id, b: b.id }
    })
    await settle(fireLikeProd(() => runAll()))
    expect(frame.run(() => skippedCellsAtom())).toEqual([ids.b])

    const threw = await settle(fireLikeProd(() => resumeQueue()))
    expect(threw && String(threw)).toBe(null)
    expect(frame.run(() => runtimeStatusAtom())).toBe('idle')
  }, 15000)
})
