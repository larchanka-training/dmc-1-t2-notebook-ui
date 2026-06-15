// Shared harness for testing async Reatom handlers under PRODUCTION `clearStack()`.
//
// Production `src/setup.ts` calls `clearStack()`, which disables Reatom's implicit
// global-context fallback: any atom read/write in an async continuation that is
// not re-bound with `wrap` throws `missing async stack`. The shared test setup
// (`src/test/setup.ts`) does NOT enable `clearStack()` — it would break the
// direct-atom-access seeding that most suites rely on — so a missing inner `wrap`
// after an `await` passes green in the default suite and only throws in the
// browser (review H1/H2).
//
// This module makes the production invariant testable per call, so any suite that
// exercises a `wrap(async () => { await ...; atom.set(...) })` handler can prove
// the continuation survives `clearStack()`. Use it for every new awaited-then-
// atom-write handler (delete/open dialogs, sidebar actions, slot mutators).

import { clearStack, context, STACK, wrap } from '@reatom/core'

export type ReatomFrame = ReturnType<typeof context.start>

/**
 * Fire `fn` the way a wrapped UI handler runs in production: capture the wrapped
 * handler in-frame (as `reatomComponent` does at render time), empty the global
 * stack via `clearStack()` (as production does at boot), then invoke it "later"
 * (the click). This is the exact boundary that throws `missing async stack` if
 * the handler drops the Reatom context after an `await`.
 *
 * Pass the per-test `frame` from `context.start()` (see `reseedGlobalStack` for
 * the matching `afterEach` cleanup).
 */
export function fireLikeProd<T>(frame: ReatomFrame, fn: () => T): T {
  const handler = frame.run(() => wrap(fn))
  clearStack()
  return handler()
}

/**
 * Resolve `value` and return the thrown error (or `null` if it settled cleanly),
 * without rethrowing — so a test can assert the presence/absence of a
 * `missing async stack` throw explicitly instead of relying on an unhandled
 * rejection.
 */
export async function settle(value: unknown): Promise<unknown> {
  let threw: unknown = null
  await Promise.resolve(value).catch((error) => {
    threw = error
  })
  return threw
}

/**
 * Re-seed the global Reatom stack that `clearStack()` emptied, so the shared
 * `context.reset()` in `src/test/setup.ts` does not throw on the next test. Call
 * from `afterEach` in any suite that uses `fireLikeProd`.
 */
export function reseedGlobalStack(): void {
  if (STACK.length === 0) STACK.push(context.start())
}
