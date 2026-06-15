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
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { clearStack, context, STACK, wrap } from '@reatom/core'
import { notebookStorage } from '../persistence/activeStorage'
import { hasLocalChangesAtom, saveNow, saveStatusAtom } from './autosave'
import { notebookRevisionAtom } from './revision'

let frame: ReturnType<typeof context.start>

beforeEach(() => {
  // Fresh isolated context per test → clean atom state (seed notebook, idle status).
  frame = context.start()
  vi.spyOn(notebookStorage, 'putIfNewer').mockResolvedValue({ ok: true })
})

afterEach(() => {
  vi.restoreAllMocks()
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

  test('runSaveLoop survives a 2nd iteration (saveAgainAfterCurrent) without missing async stack (C1)', async () => {
    // C1 regression: with a bare `await runConditionalSave()` the loop's 2nd
    // iteration resumes on an empty stack and the `while`-condition atom reads
    // (hasLocalChangesAtom / saveStatusAtom) throw `missing async stack` under
    // production clearStack(). With `await wrap(runConditionalSave())` it survives.
    let resolveFirst!: (value: { ok: true }) => void
    let calls = 0
    vi.spyOn(notebookStorage, 'putIfNewer').mockImplementation(() => {
      calls += 1
      if (calls === 1) return new Promise<{ ok: true }>((res) => (resolveFirst = res))
      return Promise.resolve({ ok: true })
    })

    // Capture two wrapped handlers (render time), then fire them with an empty stack.
    const run = frame.run(() => wrap(() => saveNow()))
    const runAgain = frame.run(() => wrap(() => saveNow()))
    clearStack()

    const p1 = settle(run())
    // First iteration is parked at putIfNewer. Dirty the editor again and request
    // another save so the loop runs a SECOND iteration once the first is released.
    frame.run(() => notebookRevisionAtom.set((revision) => revision + 1))
    const p2 = settle(runAgain())
    resolveFirst({ ok: true })

    const threw1 = await p1
    const threw2 = await p2
    expect(threw1 && String(threw1)).toBe(null)
    expect(threw2 && String(threw2)).toBe(null)
    expect(calls).toBeGreaterThanOrEqual(2)
    expect(frame.run(() => saveStatusAtom())).not.toBe('error')
    expect(frame.run(() => hasLocalChangesAtom())).toBe(false)
  })
})
