import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { notebook as notebookApi } from '@/shared/api'
import { accessTokenAtom, userAtom } from '@/entities/session'
import { notebookStorage } from '../persistence/activeStorage'
import type { NotebookJSON } from '../persistence/schema'
import { activeNotebookIdAtom, cellsAtom, DEMO_NOTEBOOK_ID, LOCAL_NOTEBOOK_ID } from './notebook'
import { isOnlineAtom } from './online'
import { degradeSlotToFloor, openNotebookInSlot, startSlot, stopSlot } from './slot'

// CL-9: the real `degradeSlotToFloor` / open re-arm path is mocked away in every
// other suite (`slot.test.ts` stubs ./autosave + ./remoteSync; `notebookList.test`
// stubs ./slot). This integration suite exercises the REAL collaborators —
// `notebook.ts`, autosave, remote-sync — over `fake-indexeddb`, so the sequence
// `stopBindings → set DEMO → await loadNotebook (re-seed) → startBindings` is
// genuinely run. It is exactly what proves the CL-1/CL-2/CL-4 fixes hold end to end.
//
// Signed OUT on purpose: the remote-sync engine self-guards on auth, so it stays
// idle (no network) while we still get the real start/teardown lifecycle.

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

beforeEach(async () => {
  await notebookStorage.clearAll()
  accessTokenAtom.set(null) // signed out → remote-sync stays idle, no network
  userAtom.set(null)
  isOnlineAtom.set(true)
  activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
  // open-into-slot always fetches the server version first; mock it to the same
  // backend doc so the integration exercises the real pull → storage → re-arm
  // path deterministically instead of hitting the network (401).
  vi.spyOn(notebookApi, 'get').mockImplementation(
    async (id: string) =>
      ({ ...doc(id, 'Backend'), ownerId: 'o' }) as Awaited<ReturnType<typeof notebookApi.get>>,
  )
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
  stopSlot()
  // Let the torn-down bindings' fire-and-forget IndexedDB reads (real
  // fake-indexeddb) settle under the still-valid reatom root before the next
  // test's `context.reset()` swaps it — otherwise those late `wrap`s throw a
  // stray "context reset" AbortError. The engine no-ops them via its isActive()
  // guard; we just need them to resolve in-window.
  await new Promise((resolve) => setTimeout(resolve))
  vi.restoreAllMocks()
  activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
})

describe('slot lifecycle (integration, real bindings + fake-indexeddb)', () => {
  test('a concurrent open + degrade do not interleave (serialized lock) (CL-1)', async () => {
    await notebookStorage.put(doc(SERVER_ID, 'Backend'))
    startSlot()

    // Fire an open and a degrade in the same tick; the shared lock serializes them,
    // so neither leaves the slot half-bound. The final state is internally
    // consistent (active id matches whichever op won, editor matches that id).
    await Promise.all([openNotebookInSlot(SERVER_ID), degradeSlotToFloor()])

    const activeId = activeNotebookIdAtom()
    expect([SERVER_ID, DEMO_NOTEBOOK_ID]).toContain(activeId)
    // The editor content is consistent with the winning id.
    const expectedContent = activeId === SERVER_ID ? 'server-content' : '# Welcome to JS Notebook'
    expect(cellsAtom()[0].code()).toBe(expectedContent)
  })
})
