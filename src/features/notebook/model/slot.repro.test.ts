// Regression: slot switches (open-into-slot, degrade-to-floor) must keep their
// id-dependent atom writes / reads consistent across EVERY internal `await`,
// under production `clearStack()`.
//
// In production `src/setup.ts` calls `clearStack()`, disabling Reatom's implicit
// global-context fallback: any atom write/read in an async continuation that is
// not re-bound with `wrap` throws `missing async stack`. The shared test setup
// does NOT enable clearStack() (it would break the direct-atom-access tests in
// slot.test.ts / slot.integration.test.ts), so this file emulates the production
// invariant per call — the same approach as runtime.repro.test.ts.
//
// This is the seam that broke open-into-slot in the browser: `Promise.race`
// inside an async `withTimeout`, and a bare `await flip()` before `startBindings`,
// dropped the async stack so `activeNotebookIdAtom.set` / the atom reads in
// `startBindings` threw `missing async stack`. Unit tests with mocked bindings
// could not catch it because they don't run under clearStack().
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { clearStack, context, STACK, wrap } from '@reatom/core'
import { notebook as notebookApi } from '@/shared/api'
import { accessTokenAtom, userAtom } from '@/entities/session'
import { notebookStorage } from '../persistence/activeStorage'
import type { NotebookJSON } from '../persistence/schema'
import { activeNotebookIdAtom, cellsAtom, LOCAL_NOTEBOOK_ID, SEED_CODE } from './notebook'
import { isOnlineAtom } from './online'
import { degradeSlotToFloor, openNotebookInSlot, startSlot, stopSlot } from './slot'

const SERVER_ID = '99999999-9999-4999-8999-999999999999'
const CELL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function doc(id: string, title: string): NotebookJSON {
  return {
    formatVersion: 1,
    id,
    title,
    createdAt: 1,
    updatedAt: 2,
    cells: [{ id: CELL, kind: 'code', content: 'server-content', updatedAt: 1 }],
  }
}

let frame: ReturnType<typeof context.start>

beforeEach(async () => {
  frame = context.start()
  await frame.run(() => notebookStorage.clearAll())
  frame.run(() => {
    accessTokenAtom.set(null) // signed out → remote-sync stays idle, no network
    userAtom.set(null)
    isOnlineAtom.set(true)
    activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
  })
})

afterEach(() => {
  frame.run(() => stopSlot())
  vi.restoreAllMocks()
  // Re-seed the global stack emptied by clearStack() so the shared
  // `context.reset()` in src/test/setup.ts doesn't throw on the next test.
  if (STACK.length === 0) STACK.push(context.start())
})

/**
 * Fire an action the way the wrapped sidebar handler does: capture context at
 * render time (inside the frame) via `wrap`, then empty the global stack and
 * invoke "later" (the click). This is the boundary that throws
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

describe('slot switch async-stack safety (production clearStack)', () => {
  test('openNotebookInSlot switches the slot without throwing missing async stack', async () => {
    await frame.run(() => notebookStorage.put(doc(SERVER_ID, 'Backend')))
    frame.run(() => startSlot())

    const threw = await settle(fireLikeProd(() => openNotebookInSlot(SERVER_ID)))

    expect(threw && String(threw)).toBe(null)
    expect(frame.run(() => activeNotebookIdAtom())).toBe(SERVER_ID)
    expect(frame.run(() => cellsAtom()[0].code())).toBe('server-content')
  })

  test('openNotebookInSlot via lazy fetch does not throw across the await chain', async () => {
    // No local copy → the lazy GET + pull + re-read + drain + re-arm chain runs,
    // which is the longest await sequence and the one that broke in the browser.
    frame.run(() => startSlot())
    vi.spyOn(notebookApi, 'get').mockResolvedValue({
      ...doc(SERVER_ID, 'Fetched'),
      ownerId: 'o',
    } as Awaited<ReturnType<typeof notebookApi.get>>)

    const threw = await settle(fireLikeProd(() => openNotebookInSlot(SERVER_ID)))

    expect(threw && String(threw)).toBe(null)
    expect(frame.run(() => activeNotebookIdAtom())).toBe(SERVER_ID)
  })

  test('degradeSlotToFloor returns to the welcome floor without throwing', async () => {
    await frame.run(() => notebookStorage.put(doc(SERVER_ID, 'Backend')))
    frame.run(() => startSlot())
    await settle(fireLikeProd(() => openNotebookInSlot(SERVER_ID)))
    expect(frame.run(() => activeNotebookIdAtom())).toBe(SERVER_ID)

    const threw = await settle(fireLikeProd(() => degradeSlotToFloor()))

    expect(threw && String(threw)).toBe(null)
    expect(frame.run(() => activeNotebookIdAtom())).toBe(LOCAL_NOTEBOOK_ID)
    expect(frame.run(() => cellsAtom()[0].code())).toBe(SEED_CODE)
  })
})
