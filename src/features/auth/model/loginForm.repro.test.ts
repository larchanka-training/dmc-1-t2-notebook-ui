// Regression: sendCodeAction must advance the form to step 2 across its
// `await`, under production `clearStack()`.
//
// src/setup.ts calls clearStack() in production, disabling Reatom's implicit
// global-context fallback: any atom write in an async continuation that isn't
// re-bound with `wrap` throws `missing async stack`. The shared test setup does
// NOT enable clearStack(), so this file emulates the production invariant per
// call — same approach as autosave.repro.test.ts / runtime.repro.test.ts:
//
//   1. capture a `wrap`-ped call inside a real frame (= the wrapped handler);
//   2. clearStack() to empty the global stack (= production at rest);
//   3. invoke it — its async continuation now runs with an empty stack. Without
//      the `await wrap(...)` inside sendCodeAction the writes after the request
//      throw and the step never flips to 2 (the form is stuck on email entry).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { clearStack, context, STACK, wrap } from '@reatom/core'
import * as authApi from '@/shared/api/auth'
import { devOtpDataAtom, loginStepAtom, sendCodeAction } from './loginForm'

beforeEach(() => {
  vi.spyOn(authApi, 'requestOtp').mockResolvedValue({ otp: '424242', expiresAt: 1780000000000 })
})

afterEach(() => {
  vi.restoreAllMocks()
  // clearStack() empties the global stack; re-seed it so the shared
  // context.reset() in src/test/setup.ts (which calls top()) doesn't throw.
  if (STACK.length === 0) STACK.push(context.start())
})

async function settle(value: unknown): Promise<unknown> {
  let threw: unknown = null
  await Promise.resolve(value).catch((e) => {
    threw = e
  })
  return threw
}

describe('sendCodeAction async-stack safety (production clearStack)', () => {
  test('advances to step 2 and stores the dev OTP across its await', async () => {
    const frame = context.start()
    frame.run(() => loginStepAtom.set(1))

    // Capture the action the way the wrapped submit handler does (in a live
    // frame), then empty the global stack and invoke it.
    const run = frame.run(() => wrap(() => sendCodeAction('a@b.com')))
    clearStack()

    const threw = await settle(run())

    expect(threw && String(threw)).toBe(null)
    expect(frame.run(() => loginStepAtom())).toBe(2)
    expect(frame.run(() => devOtpDataAtom())?.otp).toBe('424242')
  })
})
