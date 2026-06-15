import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { notebook as notebookApi } from '@/shared/api'
import { notebookStorage } from '../persistence/activeStorage'
import type { NotebookJSON } from '../persistence/schema'
import { activeNotebookIdAtom, LOCAL_NOTEBOOK_ID } from './notebook'
import { openNotebookInSlot, slotOpenErrorAtom, startSlot, stopSlot } from './slot'

// The slot controller drives the id-dependent bindings (autosave / remote-sync /
// AI context) and the pull helper. Mock those collaborators so this suite asserts
// the SWITCH ORCHESTRATION (drain → teardown → flip id → re-arm) in isolation,
// with real `notebook.ts` (so `restoreNotebook` actually flips the active id) and
// real storage/API seams (spied per test).
const h = vi.hoisted(() => ({
  startAutosave: vi.fn(),
  drainAutosave: vi.fn(),
  startRemoteSync: vi.fn(),
  startAiContextSync: vi.fn(),
  pullServerNotebook: vi.fn(),
  autosaveTeardown: vi.fn(),
  remoteTeardown: vi.fn(),
}))

vi.mock('./autosave', () => ({
  startAutosave: h.startAutosave,
  drainAutosave: h.drainAutosave,
}))
vi.mock('./remoteSync', () => ({ startRemoteSync: h.startRemoteSync }))
vi.mock('./context-ai/aiContext', () => ({ startAiContextSync: h.startAiContextSync }))
vi.mock('./pull', () => ({ pullServerNotebook: h.pullServerNotebook }))

const SERVER_ID = '99999999-9999-4999-8999-999999999999'
const CELL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function doc(id: string, title = 'Doc'): NotebookJSON {
  return {
    formatVersion: 1,
    id,
    title,
    createdAt: 1,
    updatedAt: 2,
    cells: [{ id: CELL, kind: 'code', content: 'x', updatedAt: 1 }],
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

let getSpy: ReturnType<typeof vi.spyOn>
let apiGetSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
  h.startAutosave.mockReturnValue(h.autosaveTeardown)
  h.startRemoteSync.mockReturnValue(h.remoteTeardown)
  h.startAiContextSync.mockReturnValue(vi.fn())
  h.drainAutosave.mockResolvedValue(undefined)
  h.pullServerNotebook.mockResolvedValue('accepted')
  getSpy = vi.spyOn(notebookStorage, 'get')
  // open-into-slot now ALWAYS fetches the server version first (picks up edits
  // from another device); default the fetch to a benign server doc so tests that
  // don't care about the network don't hang on an unmocked GET.
  apiGetSpy = vi.spyOn(notebookApi, 'get').mockResolvedValue({
    ...doc(SERVER_ID),
    ownerId: 'o',
  } as unknown as notebookApi.Notebook)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  stopSlot()
  vi.restoreAllMocks()
  activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
})

describe('openNotebookInSlot', () => {
  test('always fetches the server version first, then reconciles via pull', async () => {
    // Even with a local copy present, the open path fetches the server doc so a
    // newer remote version is picked up; `pullServerNotebook` reconciles it.
    const server = { ...doc(SERVER_ID), ownerId: 'o' } as unknown as notebookApi.Notebook
    apiGetSpy.mockResolvedValue(server)
    getSpy.mockResolvedValue(doc(SERVER_ID))

    await openNotebookInSlot(SERVER_ID)

    // The GET is passed the id plus an AbortSignal (M3: abortable on timeout).
    expect(apiGetSpy).toHaveBeenCalledWith(SERVER_ID, expect.any(AbortSignal))
    expect(h.pullServerNotebook).toHaveBeenCalledWith(server)
    expect(activeNotebookIdAtom()).toBe(SERVER_ID)
    expect(h.startRemoteSync).toHaveBeenCalledWith(SERVER_ID)
  })

  test('falls back to the local copy when the server fetch fails (offline)', async () => {
    // Fetch rejects (offline), but a previously-downloaded copy is in storage —
    // the notebook still opens from local storage.
    apiGetSpy.mockRejectedValue(new Error('network down'))
    getSpy.mockResolvedValue(doc(SERVER_ID))

    const outcome = await openNotebookInSlot(SERVER_ID)

    expect(outcome).toBe('opened')
    expect(h.pullServerNotebook).not.toHaveBeenCalled() // no server doc to reconcile
    expect(activeNotebookIdAtom()).toBe(SERVER_ID)
  })

  test('drains autosave BEFORE flipping the active id (no edit leaks under the new id)', async () => {
    getSpy.mockResolvedValue(doc(SERVER_ID))
    let idDuringDrain: string | undefined
    h.drainAutosave.mockImplementation(async () => {
      idDuringDrain = activeNotebookIdAtom()
    })

    await openNotebookInSlot(SERVER_ID)

    // The outgoing notebook's edits were flushed while the id was still the old one.
    expect(idDuringDrain).toBe(LOCAL_NOTEBOOK_ID)
    expect(activeNotebookIdAtom()).toBe(SERVER_ID)
  })

  test('tears down the previous bindings before re-arming on the new id', async () => {
    startSlot() // arm bindings for the boot notebook
    getSpy.mockResolvedValue(doc(SERVER_ID))

    await openNotebookInSlot(SERVER_ID)

    // Old remote-sync torn down (aborts in-flight push) before the new one starts.
    const teardownOrder = h.remoteTeardown.mock.invocationCallOrder[0]
    const restartOrder = h.startRemoteSync.mock.invocationCallOrder.at(-1) as number
    expect(teardownOrder).toBeLessThan(restartOrder)
    expect(h.drainAutosave.mock.invocationCallOrder[0]).toBeLessThan(teardownOrder)
  })

  test('keeps the current slot when fetch fails AND no local copy exists', async () => {
    // Offline with nothing downloaded yet: neither server nor local has the doc.
    apiGetSpy.mockRejectedValue(new Error('network down'))
    getSpy.mockResolvedValue(undefined)

    const outcome = await openNotebookInSlot(SERVER_ID)

    // Slot untouched: id unchanged, bindings not switched, outcome reported (CL-5).
    expect(outcome).toBe('unavailable')
    expect(activeNotebookIdAtom()).toBe(LOCAL_NOTEBOOK_ID)
    expect(h.startRemoteSync).not.toHaveBeenCalled()
    expect(h.drainAutosave).not.toHaveBeenCalled()
  })

  test('keeps the current slot when the server payload is rejected and re-read is empty (CL-11)', async () => {
    // GET resolves, but pull rejects the payload (§11 boundary) and the re-read is
    // still undefined → the second-null branch. The slot must stay put, not blank.
    apiGetSpy.mockResolvedValue(doc(SERVER_ID) as unknown as notebookApi.Notebook)
    getSpy.mockResolvedValue(undefined) // absent before AND after the pull
    h.pullServerNotebook.mockResolvedValue('rejected')

    const outcome = await openNotebookInSlot(SERVER_ID)

    expect(outcome).toBe('unavailable')
    expect(activeNotebookIdAtom()).toBe(LOCAL_NOTEBOOK_ID)
    expect(h.drainAutosave).not.toHaveBeenCalled()
    expect(h.startRemoteSync).not.toHaveBeenCalled()
  })

  test('is a no-op when the target is already the active notebook', async () => {
    await openNotebookInSlot(LOCAL_NOTEBOOK_ID)
    expect(getSpy).not.toHaveBeenCalled()
    expect(h.drainAutosave).not.toHaveBeenCalled()
  })

  test('ignores a concurrent switch while one is in flight', async () => {
    // Hang the first op on its server fetch (the first await now), so the second
    // call lands while the lock is held.
    const gate = deferred<notebookApi.Notebook>()
    apiGetSpy.mockReturnValueOnce(gate.promise)
    getSpy.mockResolvedValue(doc(SERVER_ID))

    const first = openNotebookInSlot(SERVER_ID)
    const secondOutcome = await openNotebookInSlot('11111111-1111-4111-8111-111111111111')
    expect(secondOutcome).toBe('busy')
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('in progress'))

    gate.resolve({ ...doc(SERVER_ID), ownerId: 'o' } as unknown as notebookApi.Notebook)
    expect(await first).toBe('opened')
    expect(activeNotebookIdAtom()).toBe(SERVER_ID)
  })

  test('contains a mid-switch throw: returns "error", surfaces a message, keeps the slot (M2)', async () => {
    slotOpenErrorAtom.set(null)
    getSpy.mockResolvedValue(doc(SERVER_ID))
    // A throw AFTER the target resolves (here: the drain step) must not escape the
    // action as an unhandled rejection — it is contained as the `'error'` outcome.
    h.drainAutosave.mockRejectedValue(new Error('drain boom'))

    const outcome = await openNotebookInSlot(SERVER_ID)

    expect(outcome).toBe('error')
    expect(slotOpenErrorAtom()).not.toBeNull()
  })

  test('rearmOrDegrade last-resort: re-arms on the active id when degrade also fails (L6)', async () => {
    getSpy.mockResolvedValue(doc(SERVER_ID))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // startBindings() calls startAutosave() first. Throw on the primary re-arm AND
    // on the degrade-to-floor re-arm, then succeed on the last-resort re-arm —
    // exercising rearmOrDegrade's inner catch (slot.ts last-resort path).
    h.startAutosave
      .mockImplementationOnce(() => {
        throw new Error('re-arm boom')
      })
      .mockImplementationOnce(() => {
        throw new Error('degrade re-arm boom')
      })
      .mockReturnValue(h.autosaveTeardown)

    const outcome = await openNotebookInSlot(SERVER_ID)

    // Contained as 'error' (M2), the last-resort logged, and bindings were
    // re-attempted a third time so persistence/sync are not left dead.
    expect(outcome).toBe('error')
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('degrade-to-floor also failed'),
      expect.anything(),
    )
    expect(h.startAutosave).toHaveBeenCalledTimes(3)
  })
})
