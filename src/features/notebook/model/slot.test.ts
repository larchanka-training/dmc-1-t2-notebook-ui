import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { notebook as notebookApi } from '@/shared/api'
import { notebookStorage } from '../persistence/activeStorage'
import type { NotebookJSON } from '../persistence/schema'
import { urlAtom } from '@reatom/core'
import { userAtom } from '@/entities/session'
import { activeNotebookIdAtom, LOCAL_NOTEBOOK_ID } from './notebook'
import { setSeedTombstone, clearSeedTombstone } from './seedTombstone'
import { setStartViewReader } from './startupTarget'
import {
  bumpSlotGeneration,
  openNotebookInSlot,
  resetSlotToFloorForAccountChange,
  slotOpenErrorAtom,
  slotOpeningPhaseAtom,
  stopSlot,
} from './slot'

// The slot controller drives the id-dependent bindings (autosave / remote-sync /
// AI context) and the pull helper. Mock those collaborators so this suite asserts
// the SWITCH ORCHESTRATION (drain → teardown → flip id → re-arm) in isolation,
// with real `notebook.ts` (so `restoreNotebook` actually flips the active id) and
// real storage/API seams (spied per test).
const h = vi.hoisted(() => ({
  startAutosave: vi.fn(),
  drainAutosave: vi.fn(),
  hasLocalChangesAtom: vi.fn(() => false),
  startRemoteSync: vi.fn(),
  startAiContextSync: vi.fn(),
  pullServerNotebook: vi.fn(),
  autosaveTeardown: vi.fn(),
  remoteTeardown: vi.fn(),
}))

vi.mock('./autosave', () => ({
  startAutosave: h.startAutosave,
  drainAutosave: h.drainAutosave,
  // slot.ts reads this to skip the SWR re-open when the editor has unsaved edits
  // for the open id (M1/A3). A plain callable stub — the real atom is a computed.
  hasLocalChangesAtom: h.hasLocalChangesAtom,
}))
vi.mock('./remoteSync', () => ({ startRemoteSync: h.startRemoteSync }))
vi.mock('./context-ai/aiContext', () => ({ startAiContextSync: h.startAiContextSync }))
vi.mock('./pull', () => ({ pullServerNotebook: h.pullServerNotebook }))

const SERVER_ID = '99999999-9999-4999-8999-999999999999'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'
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
  slotOpeningPhaseAtom.set('idle')
  h.startAutosave.mockReturnValue(h.autosaveTeardown)
  h.startRemoteSync.mockReturnValue(h.remoteTeardown)
  h.startAiContextSync.mockReturnValue(vi.fn())
  h.drainAutosave.mockResolvedValue(undefined)
  h.pullServerNotebook.mockResolvedValue('accepted')
  getSpy = vi.spyOn(notebookStorage, 'get')
  // open-into-slot always checks the server version in the background; default
  // the fetch to a benign server doc so tests that don't care about the network
  // don't hang on an unmocked GET.
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
  slotOpeningPhaseAtom.set('idle')
})

describe('openNotebookInSlot', () => {
  test('opens a local copy immediately while the server fetch is still pending', async () => {
    const server = { ...doc(SERVER_ID), ownerId: 'o' } as unknown as notebookApi.Notebook
    const gate = deferred<notebookApi.Notebook>()
    apiGetSpy.mockReturnValue(gate.promise)
    getSpy.mockResolvedValue(doc(SERVER_ID))

    const pending = openNotebookInSlot(SERVER_ID)

    await vi.waitFor(() => expect(activeNotebookIdAtom()).toBe(SERVER_ID))
    expect(slotOpeningPhaseAtom()).toBe('local-first')
    expect(h.startRemoteSync).toHaveBeenCalledWith(SERVER_ID)

    gate.resolve(server)
    await expect(pending).resolves.toBe('opened')
    expect(apiGetSpy).toHaveBeenCalledWith(SERVER_ID, expect.any(AbortSignal))
    expect(h.pullServerNotebook).toHaveBeenCalledWith(server)
    expect(slotOpeningPhaseAtom()).toBe('idle')
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

  test('shows remote-only opening phase until a non-local notebook is fetched', async () => {
    const gate = deferred<notebookApi.Notebook>()
    apiGetSpy.mockReturnValue(gate.promise)
    getSpy.mockResolvedValueOnce(undefined).mockResolvedValueOnce(doc(SERVER_ID))

    const pending = openNotebookInSlot(SERVER_ID)

    await vi.waitFor(() => expect(slotOpeningPhaseAtom()).toBe('remote-only'))
    expect(activeNotebookIdAtom()).toBe(LOCAL_NOTEBOOK_ID)

    gate.resolve({ ...doc(SERVER_ID), ownerId: 'o' } as unknown as notebookApi.Notebook)
    await expect(pending).resolves.toBe('opened')
    expect(activeNotebookIdAtom()).toBe(SERVER_ID)
    expect(slotOpeningPhaseAtom()).toBe('idle')
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
    expect(slotOpeningPhaseAtom()).toBe('idle')
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
    // Hang the first op on its background server fetch, so the second call lands
    // while the lock is held.
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
})

describe('slot generation fence (H1/H2)', () => {
  test('a concurrent generation bump supersedes the in-flight open (remote-only, no re-adopt)', async () => {
    const gate = deferred<notebookApi.Notebook>()
    apiGetSpy.mockReturnValue(gate.promise)
    getSpy.mockResolvedValue(undefined) // no local copy → parked at the lazy GET

    const pending = openNotebookInSlot(SERVER_ID)
    await vi.waitFor(() => expect(slotOpeningPhaseAtom()).toBe('remote-only'))

    bumpSlotGeneration() // a concurrent account-reset / delete invalidates this open
    gate.resolve({ ...doc(SERVER_ID), ownerId: 'o' } as unknown as notebookApi.Notebook)

    await expect(pending).resolves.toBe('superseded')
    expect(activeNotebookIdAtom()).toBe(LOCAL_NOTEBOOK_ID) // never adopted SERVER_ID
    expect(h.pullServerNotebook).not.toHaveBeenCalled() // not allowed to drive a re-adopt
  })
})

describe('slot timeout (M3)', () => {
  test('a hung GET aborts its signal and releases the lock after the 15s deadline', async () => {
    vi.useFakeTimers()
    try {
      let captured: AbortSignal | undefined
      apiGetSpy.mockImplementation((_id: string, signal?: AbortSignal) => {
        captured = signal
        return new Promise<notebookApi.Notebook>(() => {}) // never resolves
      })
      getSpy.mockResolvedValue(undefined) // no local copy → goes straight to the GET

      const pending = openNotebookInSlot(SERVER_ID)
      await vi.advanceTimersByTimeAsync(15_000)

      // The GET times out → `fetchServerNotebook` catches the `SlotTimeoutError`
      // and returns undefined → with no local copy the re-read is also empty, so
      // the documented outcome is `'unavailable'` (the timeout never surfaces as a
      // throw / `'error'`). Asserting the exact value catches a regression that
      // would let the timeout escape as `'error'` instead.
      const outcome = await pending
      expect(outcome).toBe('unavailable')
      expect(slotOpenErrorAtom()).not.toBeNull()
      // The controller aborted the in-flight GET on timeout (onTimeout → abort()).
      expect(captured?.aborted).toBe(true)

      // The lock was released: a subsequent open is NOT reported as 'busy'.
      apiGetSpy.mockResolvedValue({
        ...doc(OTHER_ID),
        ownerId: 'o',
      } as unknown as notebookApi.Notebook)
      getSpy.mockResolvedValue(doc(OTHER_ID))
      const second = await openNotebookInSlot(OTHER_ID)
      expect(second).not.toBe('busy')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('open is fenced against a lock-free reset/delete during the drain (H3/B1)', () => {
  test('a generation bump during the local-first drain makes the open bail superseded', async () => {
    // Local-first open of SERVER_ID; the drain is held open so a lock-free mutator
    // (account reset / delete) can land mid-flight and bump the generation. The
    // open must bail WITHOUT flipping the slot to SERVER_ID — otherwise it would
    // re-adopt the previous owner's notebook over the mutator's slot.
    getSpy.mockResolvedValue(doc(SERVER_ID))
    const drainGate = deferred<void>()
    h.drainAutosave.mockReturnValue(drainGate.promise)

    const pending = openNotebookInSlot(SERVER_ID)
    await vi.waitFor(() => expect(h.drainAutosave).toHaveBeenCalled())

    // A concurrent lock-free mutator invalidates the in-flight open.
    bumpSlotGeneration()
    drainGate.resolve()

    await expect(pending).resolves.toBe('superseded')
    // The slot was NOT flipped to the opened id, and no bindings were re-armed.
    expect(activeNotebookIdAtom()).toBe(LOCAL_NOTEBOOK_ID)
    expect(h.startRemoteSync).not.toHaveBeenCalledWith(SERVER_ID)
  })
})

describe('resetSlotToFloorForAccountChange — seed suppression (review opus)', () => {
  const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

  afterEach(async () => {
    await clearSeedTombstone()
    userAtom.set(null)
    await notebookStorage.clearAll()
    localStorage.clear()
    // Reset the injected startView reader to the default between tests.
    setStartViewReader(() => 'last-opened')
  })

  test('navigates to /usage (Restore) and does NOT arm bindings when the new owner has a tombstoned seed and nothing to open', async () => {
    userAtom.set({ id: OWNER, email: 'a@b.c', displayName: null, roles: [] })
    await notebookStorage.clearAll() // no local notebooks for this owner
    await setSeedTombstone() // their seed was deleted earlier
    // Empty server list -> reconcile is a no-op -> loadNotebook hits the
    // tombstone-with-no-survivor branch and raises bootSeedSuppressedAtom.
    vi.spyOn(notebookApi, 'list').mockResolvedValue([])
    const initialPath = urlAtom().pathname

    await resetSlotToFloorForAccountChange()

    // Routed to Usage (Restore), mirroring the boot path...
    expect(urlAtom().pathname).not.toBe(initialPath)
    expect(urlAtom().pathname).toMatch(/usage$/)
    // ...and the dead floor slot is NOT armed (no autosave/remote-sync on the
    // legacy floor, so the previous account's cells can't be saved/pushed).
    expect(h.startAutosave).not.toHaveBeenCalled()
    expect(h.startRemoteSync).not.toHaveBeenCalled()
  })

  // TARDIS-183 acceptance 7: the dashboard start view must NOT override the
  // tombstoned-seed → Usage routing. bootSeedSuppressed has priority.
  test('startView=dashboard does NOT route to the dashboard when the seed is tombstoned with no survivor', async () => {
    userAtom.set({ id: OWNER, email: 'a@b.c', displayName: null, roles: [] })
    await notebookStorage.clearAll()
    await setSeedTombstone()
    vi.spyOn(notebookApi, 'list').mockResolvedValue([])
    setStartViewReader(() => 'dashboard') // user prefers the dashboard…

    await resetSlotToFloorForAccountChange()

    // …but the suppressed-seed Restore path wins: Usage, not dashboard.
    expect(urlAtom().pathname).toMatch(/usage$/)
    expect(urlAtom().pathname).not.toMatch(/dashboard$/)
    expect(h.startAutosave).not.toHaveBeenCalled()
  })

  // TARDIS-183 (positive path — the flagship behaviour): startView=dashboard +
  // no tombstone → after the account-change reset the user lands on /dashboard,
  // with the slot armed underneath. Mirrors the boot path's `startup.showDashboard`
  // branch, so this also guards the boot navigation it shares.
  test('startView=dashboard routes to /dashboard when the new owner has a normal seed', async () => {
    userAtom.set({ id: OWNER, email: 'a@b.c', displayName: null, roles: [] })
    await notebookStorage.clearAll() // fresh device: loadNotebook seeds a notebook
    // No tombstone → loadNotebook(true) writes a fresh welcome seed and arms the
    // slot, bootSeedSuppressedAtom stays false.
    vi.spyOn(notebookApi, 'list').mockResolvedValue([])
    setStartViewReader(() => 'dashboard')

    await resetSlotToFloorForAccountChange()

    // Landed on the dashboard (not Usage), and the slot is armed underneath.
    expect(urlAtom().pathname).toMatch(/dashboard$/)
    expect(h.startAutosave).toHaveBeenCalled()
  })
})

describe('SWR re-open preserves an unsaved in-editor edit (M1/A3)', () => {
  test('does not re-adopt the pulled server copy when the open id is dirty in the editor', async () => {
    // Local-first open succeeds; the pull then accepts a server copy with a newer
    // updatedAt. But the editor has unsaved in-memory edits for this id, so the
    // re-open is skipped (restoreNotebook would clobber the keystroke).
    getSpy
      .mockResolvedValueOnce(doc(SERVER_ID, 'local')) // initial local-first read (updatedAt 2)
      .mockResolvedValue({ ...doc(SERVER_ID, 'server'), updatedAt: 999 }) // post-pull read-back
    h.hasLocalChangesAtom.mockReturnValue(true)

    const outcome = await openNotebookInSlot(SERVER_ID)

    expect(outcome).toBe('opened')
    // The local-first open armed bindings once (SERVER_ID); the dirty guard skipped
    // the second openResolvedNotebook, so no extra teardown/re-arm cycle ran.
    expect(h.startRemoteSync).toHaveBeenCalledTimes(1)
    expect(h.startRemoteSync).toHaveBeenCalledWith(SERVER_ID)
  })
})
