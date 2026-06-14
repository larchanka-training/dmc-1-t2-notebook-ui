import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { notebook as notebookApi } from '@/shared/api'
import { notebookStorage } from '../persistence/activeStorage'
import type { NotebookJSON } from '../persistence/schema'
import { activeNotebookIdAtom, LOCAL_NOTEBOOK_ID } from './notebook'
import { openNotebookInSlot, startSlot, stopSlot } from './slot'

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
  apiGetSpy = vi.spyOn(notebookApi, 'get')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  stopSlot()
  vi.restoreAllMocks()
  activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
})

describe('openNotebookInSlot', () => {
  test('opens a notebook already in local storage without a network fetch', async () => {
    getSpy.mockResolvedValue(doc(SERVER_ID))

    await openNotebookInSlot(SERVER_ID)

    expect(apiGetSpy).not.toHaveBeenCalled()
    expect(activeNotebookIdAtom()).toBe(SERVER_ID)
    expect(h.startRemoteSync).toHaveBeenCalledWith(SERVER_ID)
  })

  test('lazily fetches one GET /notebooks/{id} when the notebook is absent locally', async () => {
    // Absent on first read, then present after the pull writes it.
    getSpy.mockResolvedValueOnce(undefined).mockResolvedValueOnce(doc(SERVER_ID))
    const server = { ...doc(SERVER_ID), ownerId: 'o' } as unknown as notebookApi.Notebook
    apiGetSpy.mockResolvedValue(server)

    await openNotebookInSlot(SERVER_ID)

    expect(apiGetSpy).toHaveBeenCalledTimes(1)
    expect(apiGetSpy).toHaveBeenCalledWith(SERVER_ID)
    expect(h.pullServerNotebook).toHaveBeenCalledWith(server)
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

  test('keeps the current slot when the lazy fetch fails', async () => {
    getSpy.mockResolvedValue(undefined)
    apiGetSpy.mockRejectedValue(new Error('network down'))

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
    getSpy.mockResolvedValue(undefined) // absent before AND after the pull
    apiGetSpy.mockResolvedValue(doc(SERVER_ID) as unknown as notebookApi.Notebook)
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
    const gate = deferred<NotebookJSON | undefined>()
    getSpy.mockReturnValueOnce(gate.promise as Promise<NotebookJSON | undefined>)

    const first = openNotebookInSlot(SERVER_ID)
    // Second call lands while the first awaits the storage read → reported busy.
    const secondOutcome = await openNotebookInSlot('11111111-1111-4111-8111-111111111111')
    expect(secondOutcome).toBe('busy')
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('in progress'))

    gate.resolve(doc(SERVER_ID))
    expect(await first).toBe('opened')
    expect(activeNotebookIdAtom()).toBe(SERVER_ID)
  })
})
