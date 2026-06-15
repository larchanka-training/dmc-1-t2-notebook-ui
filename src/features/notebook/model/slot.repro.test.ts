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
import { context } from '@reatom/core'
import { fireLikeProd, reseedGlobalStack, settle } from '@/test/clearStack'
import { notebook as notebookApi } from '@/shared/api'
import { accessTokenAtom, userAtom } from '@/entities/session'
import { notebookStorage } from '../persistence/activeStorage'
import type { NotebookJSON } from '../persistence/schema'
import { activeNotebookIdAtom, cellsAtom, DEMO_NOTEBOOK_ID, LOCAL_NOTEBOOK_ID } from './notebook'
import { isOnlineAtom } from './online'
import {
  degradeSlotToFloor,
  openNotebookInSlot,
  resetSlotToFloorForAccountChange,
  settleDeletedSlotToFloor,
  startSlot,
  stopSlot,
} from './slot'

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
  // open-into-slot always fetches the server version first; mock it so the repro
  // doesn't hit the real network (401) — we only care about the async-stack frame
  // surviving the await chain, not the fetch outcome.
  vi.spyOn(notebookApi, 'get').mockResolvedValue({
    ...doc(SERVER_ID, 'Backend'),
    ownerId: 'o',
  } as Awaited<ReturnType<typeof notebookApi.get>>)
})

afterEach(() => {
  frame.run(() => stopSlot())
  vi.restoreAllMocks()
  reseedGlobalStack()
})

describe('slot switch async-stack safety (production clearStack)', () => {
  test('openNotebookInSlot switches the slot without throwing missing async stack', async () => {
    await frame.run(() => notebookStorage.put(doc(SERVER_ID, 'Backend')))
    frame.run(() => startSlot())

    const threw = await settle(fireLikeProd(frame, () => openNotebookInSlot(SERVER_ID)))

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

    const threw = await settle(fireLikeProd(frame, () => openNotebookInSlot(SERVER_ID)))

    expect(threw && String(threw)).toBe(null)
    expect(frame.run(() => activeNotebookIdAtom())).toBe(SERVER_ID)
  })

  test('degradeSlotToFloor returns to the welcome floor without throwing', async () => {
    await frame.run(() => notebookStorage.put(doc(SERVER_ID, 'Backend')))
    frame.run(() => startSlot())
    await settle(fireLikeProd(frame, () => openNotebookInSlot(SERVER_ID)))
    expect(frame.run(() => activeNotebookIdAtom())).toBe(SERVER_ID)

    const threw = await settle(fireLikeProd(frame, () => degradeSlotToFloor()))

    expect(threw && String(threw)).toBe(null)
    expect(frame.run(() => activeNotebookIdAtom())).toBe(DEMO_NOTEBOOK_ID)
    expect(frame.run(() => cellsAtom()[0].code())).toContain('# Welcome to JS Notebook')
  })

  test('resetSlotToFloorForAccountChange returns to the floor without throwing (M4)', async () => {
    await frame.run(() => notebookStorage.put(doc(SERVER_ID, 'Backend')))
    frame.run(() => startSlot())
    await settle(fireLikeProd(frame, () => openNotebookInSlot(SERVER_ID)))
    expect(frame.run(() => activeNotebookIdAtom())).toBe(SERVER_ID)

    const threw = await settle(fireLikeProd(frame, () => resetSlotToFloorForAccountChange()))

    expect(threw && String(threw)).toBe(null)
    expect(frame.run(() => activeNotebookIdAtom())).toBe(DEMO_NOTEBOOK_ID)
    expect(frame.run(() => cellsAtom()[0].code())).toContain('# Welcome to JS Notebook')
  })

  test('settleDeletedSlotToFloor degrades to the floor without throwing (M4)', async () => {
    await frame.run(() => notebookStorage.put(doc(SERVER_ID, 'Backend')))
    frame.run(() => startSlot())
    await settle(fireLikeProd(frame, () => openNotebookInSlot(SERVER_ID)))
    expect(frame.run(() => activeNotebookIdAtom())).toBe(SERVER_ID)

    const threw = await settle(fireLikeProd(frame, () => settleDeletedSlotToFloor()))

    expect(threw && String(threw)).toBe(null)
    expect(frame.run(() => activeNotebookIdAtom())).toBe(DEMO_NOTEBOOK_ID)
    expect(frame.run(() => cellsAtom()[0].code())).toContain('# Welcome to JS Notebook')
  })
})
