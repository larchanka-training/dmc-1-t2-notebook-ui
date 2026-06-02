// Regression: the autosave write path must keep its status atoms consistent
// across the `await` inside `saveNow`, under production `clearStack()`.
//
// In production `src/setup.ts` calls `clearStack()`, disabling Reatom's
// implicit global-context fallback: any atom write in an async continuation
// that isn't re-bound with `wrap` throws `missing async stack`. The shared test
// setup does NOT enable clearStack() (it would break the direct-atom-access
// tests in autosave.test.ts), so this file emulates the production invariant
// per call — the same approach as runtime.repro.test.ts:
//
//   1. capture a `wrap`-ped handler inside a real context frame (= render time);
//   2. clearStack() to empty the global stack (= production at rest);
//   3. invoke the handler (= the debounce timer firing later) — its async
//      continuation now runs with an empty stack. Without the `await wrap(...)`
//      around the put in saveNow, the continuation throws and the indicator
//      never reaches 'saved'.
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { clearStack, context, STACK, wrap } from '@reatom/core'
import { saveNow, saveStatusAtom } from './autosave'

let frame: ReturnType<typeof context.start>

beforeEach(() => {
  // Fresh isolated context per test → clean atom state (seed notebook, idle status).
  frame = context.start()
})

afterEach(() => {
  // Re-seed the global stack emptied by clearStack() so the shared
  // `context.reset()` in src/test/setup.ts (it calls top()) doesn't throw.
  if (STACK.length === 0) STACK.push(context.start())
})

async function settle(value: unknown): Promise<unknown> {
  let threw: unknown = null
  await Promise.resolve(value).catch((e) => {
    threw = e
  })
  return threw
}

describe('autosave async-stack safety (production clearStack)', () => {
  test('saveNow reaches "saved" across its await without throwing', async () => {
    // Capture saveNow the way the wrapped debounce timer does (at startAutosave
    // time, inside a live frame), then empty the global stack and invoke it.
    const run = frame.run(() => wrap(() => saveNow()))
    clearStack()
    const threw = await settle(run())
    expect(threw && String(threw)).toBe(null)
    expect(frame.run(() => saveStatusAtom())).toBe('saved')
  })
})
