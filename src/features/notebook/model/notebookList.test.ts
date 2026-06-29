import { peek } from '@reatom/core'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ApiError, notebook as notebookApi } from '@/shared/api'
import { NotFoundError } from '@/shared/api/errors'
import { userAtom } from '@/entities/session'
import * as idLib from '@/shared/lib/id'
import { notebookStorage } from '../persistence/activeStorage'
import { FORMAT_VERSION } from '../persistence/schema'
import * as notebookModel from './notebook'
import { activeNotebookIdAtom, LOCAL_NOTEBOOK_ID } from './notebook'
import { isSeedTombstoned } from './seedTombstone'
import {
  createNotebookAction,
  createNotebookFlow,
  promoteSeedFloorIfUnsynced,
  deleteNotebookAction,
  localNotebooksRevisionAtom,
  notebookListResource,
  renameListItem,
  startNotebookListSync,
  canCreateNotebook,
  MAX_NOTEBOOKS,
} from './notebookList'

// Delete drives the slot controller's two-phase active-delete API (quiesce before
// the server DELETE; settle/restore after). Mock those so this suite asserts the
// delete action's own orchestration and ordering without booting the real
// autosave/remote-sync/AI bindings the controller starts.
const slotMock = vi.hoisted(() => ({
  bumpSlotGeneration: vi.fn(),
  openNotebookInSlot: vi.fn(),
  quiesceActiveSlot: vi.fn(),
  resetSlotToFloorForAccountChange: vi.fn(),
  restoreActiveSlotBindings: vi.fn(),
  settleDeletedSlotToFloor: vi.fn(),
}))
vi.mock('./slot', () => ({
  bumpSlotGeneration: slotMock.bumpSlotGeneration,
  openNotebookInSlot: slotMock.openNotebookInSlot,
  quiesceActiveSlot: slotMock.quiesceActiveSlot,
  resetSlotToFloorForAccountChange: slotMock.resetSlotToFloorForAccountChange,
  restoreActiveSlotBindings: slotMock.restoreActiveSlotBindings,
  settleDeletedSlotToFloor: slotMock.settleDeletedSlotToFloor,
}))

// A fixed client UUID so the create payload (FU1) is deterministic to assert.
const CLIENT_ID = '11111111-1111-4111-8111-111111111111'

// GET /notebooks returns lightweight rows (NotebookListItem); POST returns the
// full Notebook. Helpers keep the two shapes straight in the assertions below.
const listItem = (id: string, title: string): notebookApi.NotebookListItem => ({
  id,
  title,
  formatVersion: FORMAT_VERSION,
  createdAt: 0,
  updatedAt: 0,
  cellsCount: 0,
})

const fullNotebook = (id: string, title: string): notebookApi.Notebook => ({
  id,
  title,
  ownerId: 'owner-1',
  formatVersion: FORMAT_VERSION,
  createdAt: 0,
  updatedAt: 0,
  cells: [],
})

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.spyOn(idLib, 'newId').mockReturnValue(CLIENT_ID)
  vi.spyOn(notebookApi, 'list').mockResolvedValue([])
  notebookListResource.reset()
  createNotebookAction.error.set(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createNotebookAction', () => {
  test('creates the notebook and invalidates the resource', async () => {
    const existing = listItem('nb1', 'old')
    notebookListResource.data.set([existing])

    const created = fullNotebook('nb2', 'new')
    const createdItem = listItem('nb2', 'new')
    const createSpy = vi.spyOn(notebookApi, 'create').mockResolvedValue(created)
    vi.spyOn(notebookApi, 'list').mockResolvedValue([existing, createdItem])

    const result = await createNotebookAction('new')

    expect(result).toEqual(created)
    expect(createSpy).toHaveBeenCalledWith({
      id: CLIENT_ID,
      title: 'new',
      formatVersion: FORMAT_VERSION,
    })
    expect(peek(notebookListResource.data)).toEqual([existing, createdItem])
  })

  test('seeds remoteCreated sync-state so the first edit PATCHes, not re-POSTs (TARDIS-167 #10)', async () => {
    userAtom.set({ id: 'owner-9', email: 'a@b.c', displayName: null, roles: [] })
    const created = { ...fullNotebook(CLIENT_ID, 'new'), updatedAt: 4242 }
    vi.spyOn(notebookApi, 'create').mockResolvedValue(created)
    const putSyncSpy = vi.spyOn(notebookStorage, 'putSyncState').mockResolvedValue()

    await createNotebookAction('new')

    // The notebook exists server-side already, so its sync-state must boot the
    // remote-sync engine as `remoteCreated` — otherwise the first edit re-POSTs it.
    expect(putSyncSpy).toHaveBeenCalledWith({
      notebookId: CLIENT_ID,
      remoteCreated: true,
      dirty: false,
      deletedCells: [],
      ownerId: 'owner-9',
      lastSyncedUpdatedAt: 4242,
    })

    userAtom.set(null)
  })

  test('keeps the reconciled row when the post-create refetch fails (FU2)', async () => {
    const existing = listItem('nb1', 'old')
    notebookListResource.data.set([existing])

    // Server echoes the client id; the list refetch then fails transiently.
    const created = fullNotebook(CLIENT_ID, 'new')
    vi.spyOn(notebookApi, 'create').mockResolvedValue(created)
    vi.spyOn(notebookApi, 'list').mockRejectedValue(new ApiError(503, 'unavailable', 'down'))

    const result = await createNotebookAction('new')

    // The create succeeded, so the action resolves and the optimistic row is
    // reconciled to the server notebook — NOT rolled back by the failed refetch.
    // Prepended (TARDIS-167 #3 follow-up): newest-first matches the createdAt-desc
    // list order, so the new row sits at the TOP, not the bottom.
    expect(result).toEqual(created)
    expect(peek(notebookListResource.data)).toEqual([listItem(CLIENT_ID, 'new'), existing])
  })

  test('refuses empty titles without calling the API', async () => {
    const createSpy = vi.spyOn(notebookApi, 'create')
    const result = await createNotebookAction('   ')
    expect(result).toBeNull()
    expect(createSpy).not.toHaveBeenCalled()
  })

  test('surfaces error via createNotebookAction.error() on 401', async () => {
    vi.spyOn(notebookApi, 'create').mockRejectedValue(new ApiError(401, 'unauthenticated', 'nope'))

    await expect(createNotebookAction('new')).rejects.toThrow()
    expect(createNotebookAction.error()).toBeDefined()
  })

  test('rolls back the optimistic update when the API rejects', async () => {
    const existing = listItem('nb1', 'old')
    notebookListResource.data.set([existing])
    vi.spyOn(notebookApi, 'create').mockRejectedValue(new ApiError(500, 'boom', 'boom'))

    await expect(createNotebookAction('new')).rejects.toThrow()
    expect(peek(notebookListResource.data)).toEqual([existing])
  })

  test('dedupes overlapping creates at the model level — one API call (CL-12)', async () => {
    const created = fullNotebook(CLIENT_ID, 'new')
    const gate = deferred<notebookApi.Notebook>()
    const createSpy = vi.spyOn(notebookApi, 'create').mockReturnValue(gate.promise)

    // Two overlapping calls (e.g. a shortcut firing while the button is mid-create):
    // the second is a no-op until the first settles, so only ONE POST goes out.
    const first = createNotebookAction('new')
    const second = await createNotebookAction('new')
    expect(second).toBeNull()
    expect(createSpy).toHaveBeenCalledTimes(1)

    gate.resolve(created)
    expect(await first).toEqual(created)
  })
})

describe('notebook cap (TARDIS-173)', () => {
  beforeEach(() => {
    activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
  })
  afterEach(() => {
    activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
  })

  // Build N listed rows, with one of them active so no synthetic floor row is
  // added on top (effectiveNotebookCount would otherwise be N + 1).
  const fillList = (n: number) => {
    const rows = Array.from({ length: n }, (_, i) =>
      listItem(`${i}`.padStart(8, '0') + '-0000-4000-8000-000000000000', `nb-${i}`),
    )
    notebookListResource.data.set(rows)
    if (rows.length > 0) activeNotebookIdAtom.set(rows[0].id)
  }

  test('canCreateNotebook() is true below the cap and false at it', () => {
    fillList(MAX_NOTEBOOKS - 1)
    expect(canCreateNotebook()).toBe(true)

    fillList(MAX_NOTEBOOKS)
    expect(canCreateNotebook()).toBe(false)
  })

  test('createNotebookAction is a no-op at the cap (no API call)', async () => {
    fillList(MAX_NOTEBOOKS)
    const createSpy = vi.spyOn(notebookApi, 'create')

    const result = await createNotebookAction('over the limit')

    expect(result).toBeNull()
    expect(createSpy).not.toHaveBeenCalled()
  })

  test('the unsynced seed floor counts toward the cap', () => {
    // MAX-1 listed rows + an active floor (active id not in the list) = MAX slots.
    const rows = Array.from({ length: MAX_NOTEBOOKS - 1 }, (_, i) =>
      listItem(`${i}`.padStart(8, '0') + '-0000-4000-8000-000000000000', `nb-${i}`),
    )
    notebookListResource.data.set(rows)
    activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID) // floor row, not in the list

    expect(canCreateNotebook()).toBe(false)
  })
})

describe('createNotebookFlow (TARDIS-173: sidebar orchestration moved to the model)', () => {
  beforeEach(() => {
    slotMock.openNotebookInSlot.mockReset().mockResolvedValue('opened')
    activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
    userAtom.set({ id: 'flow-owner', email: 'a@b.c', displayName: null, roles: [] })
    notebookListResource.data.set([])
  })
  afterEach(() => {
    activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
    userAtom.set(null)
  })

  test('creates a notebook (emoji title) and opens it, returning the created notebook', async () => {
    const created = fullNotebook(CLIENT_ID, '✨ Untitled notebook')
    const createSpy = vi.spyOn(notebookApi, 'create').mockResolvedValue(created)

    const result = await createNotebookFlow()

    // Titled "<emoji> Untitled notebook" — assert the shape, not a fixed emoji.
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringMatching(/ Untitled notebook$/) }),
    )
    expect(slotMock.openNotebookInSlot).toHaveBeenCalledWith(CLIENT_ID)
    expect(result).toEqual(created)
  })

  test('returns null without opening when nothing was created (e.g. at the cap)', async () => {
    // Fill to the cap so createNotebookAction no-ops (returns null).
    const rows = Array.from({ length: MAX_NOTEBOOKS }, (_, i) =>
      listItem(`${i}`.padStart(8, '0') + '-0000-4000-8000-000000000000', `nb-${i}`),
    )
    notebookListResource.data.set(rows)
    activeNotebookIdAtom.set(rows[0].id)
    const createSpy = vi.spyOn(notebookApi, 'create')

    const result = await createNotebookFlow()

    expect(result).toBeNull()
    expect(createSpy).not.toHaveBeenCalled()
    expect(slotMock.openNotebookInSlot).not.toHaveBeenCalled()
  })

  test('returns null when the open did not succeed (so the caller does not navigate)', async () => {
    vi.spyOn(notebookApi, 'create').mockResolvedValue(
      fullNotebook(CLIENT_ID, '✨ Untitled notebook'),
    )
    slotMock.openNotebookInSlot.mockResolvedValue('unavailable')

    const result = await createNotebookFlow()

    expect(slotMock.openNotebookInSlot).toHaveBeenCalledWith(CLIENT_ID)
    expect(result).toBeNull()
  })
})

describe('renameListItem (TARDIS-167 #2)', () => {
  test('patches a listed row title in place (no refetch — the title rides autosave → PATCH)', () => {
    notebookListResource.data.set([listItem('a', 'Old A'), listItem('b', 'B')])

    renameListItem('a', 'New A')

    expect(peek(notebookListResource.data)).toEqual([listItem('a', 'New A'), listItem('b', 'B')])
  })

  test('is a no-op for an id that is not in the list', () => {
    const rows = [listItem('a', 'A')]
    notebookListResource.data.set(rows)

    renameListItem('missing', 'X')

    expect(peek(notebookListResource.data)).toEqual([listItem('a', 'A')])
  })
})

describe('promoteSeedFloorIfUnsynced (TARDIS-167 #9)', () => {
  const SEED_ID = '99999999-9999-4999-8999-999999999999'

  const storedSeed = (): import('../persistence/schema').NotebookJSON => ({
    formatVersion: FORMAT_VERSION,
    id: SEED_ID,
    title: 'Welcome',
    createdAt: 1,
    updatedAt: 1,
    cells: [],
  })

  beforeEach(() => {
    userAtom.set({ id: 'owner-9', email: 'a@b.c', displayName: null, roles: [] })
    activeNotebookIdAtom.set(SEED_ID)
  })

  afterEach(() => {
    userAtom.set(null)
    activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
  })

  test('creates a backend notebook for a clean unsynced seed and lists it', async () => {
    vi.spyOn(notebookStorage, 'getSyncState').mockResolvedValue(undefined)
    vi.spyOn(notebookStorage, 'get').mockResolvedValue(storedSeed())
    vi.spyOn(notebookStorage, 'put').mockResolvedValue()
    vi.spyOn(notebookStorage, 'putSyncState').mockResolvedValue()
    const created = { ...fullNotebook(SEED_ID, 'Welcome'), updatedAt: 7 }
    const createSpy = vi.spyOn(notebookApi, 'create').mockResolvedValue(created)

    await promoteSeedFloorIfUnsynced()

    expect(createSpy).toHaveBeenCalledWith({
      id: SEED_ID,
      title: 'Welcome',
      formatVersion: FORMAT_VERSION,
      cells: [],
    })
    // The listed row carries the server's authoritative values (updatedAt: 7).
    expect(peek(notebookListResource.data)).toEqual([
      { ...listItem(SEED_ID, 'Welcome'), updatedAt: 7 },
    ])
  })

  test('inserts the promoted seed by createdAt desc, not at the bottom (PR #85 review)', async () => {
    // Existing rows: one newer than the seed, one older. The promoted seed
    // (createdAt 50) must land BETWEEN them, not appended at the end.
    const newer = { ...listItem('newer', 'Newer'), createdAt: 100 }
    const older = { ...listItem('older', 'Older'), createdAt: 10 }
    notebookListResource.data.set([newer, older])
    vi.spyOn(notebookStorage, 'getSyncState').mockResolvedValue(undefined)
    vi.spyOn(notebookStorage, 'get').mockResolvedValue(storedSeed())
    vi.spyOn(notebookStorage, 'put').mockResolvedValue()
    vi.spyOn(notebookStorage, 'putSyncState').mockResolvedValue()
    const created = { ...fullNotebook(SEED_ID, 'Welcome'), createdAt: 50, updatedAt: 50 }
    vi.spyOn(notebookApi, 'create').mockResolvedValue(created)

    await promoteSeedFloorIfUnsynced()

    expect(peek(notebookListResource.data).map((it) => it.id)).toEqual(['newer', SEED_ID, 'older'])
  })

  test('does nothing for the legacy local floor id', async () => {
    activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
    const createSpy = vi.spyOn(notebookApi, 'create')

    await promoteSeedFloorIfUnsynced()

    expect(createSpy).not.toHaveBeenCalled()
  })

  test('does nothing when the seed already has dirty/created sync-state', async () => {
    vi.spyOn(notebookStorage, 'getSyncState').mockResolvedValue({
      notebookId: SEED_ID,
      remoteCreated: true,
      dirty: false,
      deletedCells: [],
    })
    const createSpy = vi.spyOn(notebookApi, 'create')

    await promoteSeedFloorIfUnsynced()

    expect(createSpy).not.toHaveBeenCalled()
  })

  test('does nothing when the seed is already a listed backend row', async () => {
    notebookListResource.data.set([listItem(SEED_ID, 'Welcome')])
    const createSpy = vi.spyOn(notebookApi, 'create')

    await promoteSeedFloorIfUnsynced()

    expect(createSpy).not.toHaveBeenCalled()
  })
})

describe('deleteNotebookAction', () => {
  const NB_ID = '55555555-5555-4555-8555-555555555555'

  beforeEach(async () => {
    slotMock.quiesceActiveSlot.mockReset().mockResolvedValue(undefined)
    slotMock.restoreActiveSlotBindings.mockReset()
    slotMock.settleDeletedSlotToFloor.mockReset().mockResolvedValue(undefined)
    slotMock.openNotebookInSlot.mockReset().mockResolvedValue('opened')
    vi.spyOn(notebookStorage, 'delete').mockResolvedValue()
    vi.spyOn(notebookStorage, 'deleteSyncState').mockResolvedValue()
    activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
    // A signed-in user so the per-account seed tombstone has an owner; clear any
    // tombstone left by a previous test for isolation.
    userAtom.set({ id: 'delete-suite-owner', roles: [] } as never)
    await notebookStorage.clearAll()
  })

  afterEach(async () => {
    activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
    await notebookStorage.clearAll()
    userAtom.set(null)
  })

  test('removes the row, deletes server-side, and cleans up local storage', async () => {
    const other = listItem('keep', 'Keep me')
    notebookListResource.data.set([other, listItem(NB_ID, 'Doomed')])
    const removeSpy = vi.spyOn(notebookApi, 'remove').mockResolvedValue()

    await deleteNotebookAction(NB_ID)

    expect(removeSpy).toHaveBeenCalledWith(NB_ID)
    expect(peek(notebookListResource.data)).toEqual([other])
    expect(notebookStorage.delete).toHaveBeenCalledWith(NB_ID)
    expect(notebookStorage.deleteSyncState).toHaveBeenCalledWith(NB_ID)
    // Not the active notebook → the slot is left alone (no quiesce / settle).
    expect(slotMock.quiesceActiveSlot).not.toHaveBeenCalled()
    expect(slotMock.settleDeletedSlotToFloor).not.toHaveBeenCalled()
  })

  test('rolls the row back when the server DELETE fails', async () => {
    const other = listItem('keep', 'Keep me')
    notebookListResource.data.set([other, listItem(NB_ID, 'Doomed')])
    vi.spyOn(notebookApi, 'remove').mockRejectedValue(new ApiError(500, 'boom', 'boom'))

    await expect(deleteNotebookAction(NB_ID)).rejects.toThrow()
    // The optimistic removal is rolled back: the row is still present.
    expect(peek(notebookListResource.data)).toEqual([other, listItem(NB_ID, 'Doomed')])
  })

  test('quiesces the slot BEFORE the server DELETE, then opens the top remaining AFTER (H1 + B-2)', async () => {
    activeNotebookIdAtom.set(NB_ID) // the doomed notebook is open in the slot
    // Two rows so the B-1 "keep at least one notebook" guard does not short-circuit.
    notebookListResource.data.set([listItem('keep', 'Keep me'), listItem(NB_ID, 'Doomed')])
    const removeSpy = vi.spyOn(notebookApi, 'remove').mockResolvedValue()

    await deleteNotebookAction(NB_ID)

    // H1: id-bound work is stopped BEFORE the destructive request (so an in-flight
    // push can't recreate the id). B-2: after the commit the slot opens the top
    // remaining row ('keep'), NOT the resurrected seed floor.
    expect(slotMock.quiesceActiveSlot).toHaveBeenCalledTimes(1)
    expect(slotMock.openNotebookInSlot).toHaveBeenCalledTimes(1)
    expect(slotMock.openNotebookInSlot).toHaveBeenCalledWith('keep')
    expect(slotMock.settleDeletedSlotToFloor).not.toHaveBeenCalled()
    const quiesceOrder = slotMock.quiesceActiveSlot.mock.invocationCallOrder[0]
    const removeOrder = removeSpy.mock.invocationCallOrder[0]
    const openOrder = slotMock.openNotebookInSlot.mock.invocationCallOrder[0]
    expect(quiesceOrder).toBeLessThan(removeOrder)
    expect(removeOrder).toBeLessThan(openOrder)
  })

  test('re-arms the slot and rolls the row back when the active-notebook DELETE fails (H1)', async () => {
    activeNotebookIdAtom.set(NB_ID) // open in the slot
    const keep = listItem('keep', 'Keep me')
    notebookListResource.data.set([keep, listItem(NB_ID, 'Doomed')])
    vi.spyOn(notebookApi, 'remove').mockRejectedValue(new ApiError(500, 'boom', 'boom'))

    await expect(deleteNotebookAction(NB_ID)).rejects.toThrow()

    // Quiesced before the (failed) DELETE, then re-armed on the same id so the user
    // keeps the open notebook; the slot is NOT degraded; the row rolls back.
    expect(slotMock.quiesceActiveSlot).toHaveBeenCalledTimes(1)
    expect(slotMock.restoreActiveSlotBindings).toHaveBeenCalledTimes(1)
    expect(slotMock.settleDeletedSlotToFloor).not.toHaveBeenCalled()
    expect(peek(notebookListResource.data)).toEqual([keep, listItem(NB_ID, 'Doomed')])
  })

  test('does not roll back a committed DELETE even if settling the slot fails (H2)', async () => {
    activeNotebookIdAtom.set(NB_ID)
    const keep = listItem('keep', 'Keep me')
    notebookListResource.data.set([keep, listItem(NB_ID, 'Doomed')])
    vi.spyOn(notebookApi, 'remove').mockResolvedValue()
    // settle is best-effort: even if it rejected, the action must NOT reject (which
    // would roll back the committed server delete). The real settle never throws;
    // here we assert the action swallows a hypothetical settle failure.
    slotMock.settleDeletedSlotToFloor.mockRejectedValue(new Error('degrade boom'))

    await expect(deleteNotebookAction(NB_ID)).resolves.toBeUndefined()
    // Row stays removed (delete committed), not resurrected by a rollback.
    expect(peek(notebookListResource.data)).toEqual([keep])
  })

  test('refuses to delete the local welcome floor (M5)', async () => {
    const removeSpy = vi.spyOn(notebookApi, 'remove').mockResolvedValue()
    notebookListResource.data.set([listItem(LOCAL_NOTEBOOK_ID, 'Welcome')])

    await deleteNotebookAction(LOCAL_NOTEBOOK_ID)

    // Guarded no-op: no server call, no row mutation, no slot teardown.
    expect(removeSpy).not.toHaveBeenCalled()
    expect(slotMock.quiesceActiveSlot).not.toHaveBeenCalled()
    expect(peek(notebookListResource.data)).toEqual([listItem(LOCAL_NOTEBOOK_ID, 'Welcome')])
  })

  // B-1 (TARDIS-167 №23): the user must always keep at least one notebook. A
  // "true single notebook" is the active row itself with nothing else — no floor.
  test('refuses to delete the only notebook (B-1)', async () => {
    activeNotebookIdAtom.set(NB_ID) // the single row IS the open notebook (no floor)
    const removeSpy = vi.spyOn(notebookApi, 'remove').mockResolvedValue()
    notebookListResource.data.set([listItem(NB_ID, 'Only one')])

    await deleteNotebookAction(NB_ID)

    // Guarded no-op: no server call, the single row stays.
    expect(removeSpy).not.toHaveBeenCalled()
    expect(slotMock.quiesceActiveSlot).not.toHaveBeenCalled()
    expect(peek(notebookListResource.data)).toEqual([listItem(NB_ID, 'Only one')])
  })

  // B-1 review fix: the sidebar affordance and the model guard must count slots
  // identically (shared `canDeleteNotebooks()`). When an unsynced welcome-seed
  // floor is open AND one backend row exists, the user effectively has TWO slots,
  // so deleting the backend row is allowed — the floor seed remains. The old model
  // counted only `data().length` (== 1) and wrongly refused (a UI Delete the model
  // then silently no-op'd).
  test('allows deleting a backend row while an unsynced seed floor is open (B-1)', async () => {
    activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID) // floor seed open, not in the list
    const removeSpy = vi.spyOn(notebookApi, 'remove').mockResolvedValue()
    notebookListResource.data.set([listItem(NB_ID, 'One backend row')])

    await deleteNotebookAction(NB_ID)

    // The floor seed is the kept slot, so the backend row is deletable.
    expect(removeSpy).toHaveBeenCalledWith(NB_ID)
    expect(peek(notebookListResource.data)).toEqual([])
  })

  // TARDIS-167 №23 contract A: deleting the seed leaves a durable tombstone so
  // boot never resurrects it.
  test('tombstones the seed when the seed notebook is deleted', async () => {
    const SEED_ID = '99999999-9999-4999-8999-999999999999'
    vi.spyOn(notebookModel, 'resolveDemoNotebookId').mockResolvedValue(SEED_ID)
    vi.spyOn(notebookApi, 'remove').mockResolvedValue()
    // A second row so the B-1 guard allows deleting the seed.
    notebookListResource.data.set([listItem('keep', 'Keep me'), listItem(SEED_ID, 'Welcome')])

    await deleteNotebookAction(SEED_ID)

    expect(await isSeedTombstoned()).toBe(true)
    expect(peek(notebookListResource.data)).toEqual([listItem('keep', 'Keep me')])
  })

  test('does not tombstone when a non-seed notebook is deleted', async () => {
    const SEED_ID = '99999999-9999-4999-8999-999999999999'
    vi.spyOn(notebookModel, 'resolveDemoNotebookId').mockResolvedValue(SEED_ID)
    vi.spyOn(notebookApi, 'remove').mockResolvedValue()
    notebookListResource.data.set([listItem('keep', 'Keep me'), listItem(NB_ID, 'Regular')])

    await deleteNotebookAction(NB_ID)

    expect(await isSeedTombstoned()).toBe(false)
  })

  // A stale client deleting an already-deleted notebook gets 404; that is an
  // idempotent success, not a "Delete failed" error.
  test('treats a 404 as an idempotent success and still tombstones the seed', async () => {
    const SEED_ID = '99999999-9999-4999-8999-999999999999'
    vi.spyOn(notebookModel, 'resolveDemoNotebookId').mockResolvedValue(SEED_ID)
    vi.spyOn(notebookApi, 'remove').mockRejectedValue(
      new NotFoundError('NOTEBOOK_NOT_FOUND', 'Notebook not found'),
    )
    notebookListResource.data.set([listItem('keep', 'Keep me'), listItem(SEED_ID, 'Welcome')])

    // Resolves (no throw) — the dialog must NOT show a failure.
    await expect(deleteNotebookAction(SEED_ID)).resolves.toBeUndefined()
    // Row stays removed and the seed is tombstoned.
    expect(peek(notebookListResource.data)).toEqual([listItem('keep', 'Keep me')])
    expect(await isSeedTombstoned()).toBe(true)
  })

  // TARDIS-183: deleting from the sidebar must update a dashboard open in another
  // route. The dashboard merge reads a non-reactive IndexedDB snapshot, so delete
  // bumps the local-notebooks revision to force that merge to recompute and drop
  // the deleted card.
  test('bumps the local-notebooks revision after deleting (dashboard recompute)', async () => {
    vi.spyOn(notebookApi, 'remove').mockResolvedValue()
    notebookListResource.data.set([listItem('keep', 'Keep me'), listItem(NB_ID, 'Doomed')])
    const before = peek(localNotebooksRevisionAtom)

    await deleteNotebookAction(NB_ID)

    expect(peek(localNotebooksRevisionAtom)).toBeGreaterThan(before)
  })
})

const ALICE = { id: '11111111-1111-4111-8111-111111111111', roles: [] }
const BOB = { id: '22222222-2222-4222-8222-222222222222', roles: [] }

// Assert the contract of startNotebookListSync (reset + conditional retry on an
// account change) via spies on the resource, not the resource's reactive `data`:
// the computed only pushes a fetched result while it has a live subscriber, which
// a unit test doesn't set up. Whether the rows actually re-render is the
// resource's own concern, covered by the createNotebookAction tests above.
describe('startNotebookListSync (refresh on account change)', () => {
  let stop: (() => void) | undefined
  let resetSpy: ReturnType<typeof vi.spyOn>
  let retrySpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    slotMock.resetSlotToFloorForAccountChange.mockReset().mockResolvedValue(undefined)
    resetSpy = vi.spyOn(notebookListResource, 'reset').mockImplementation(() => undefined as never)
    retrySpy = vi
      .spyOn(notebookListResource, 'retry')
      .mockImplementation(() => Promise.resolve() as never)
  })

  afterEach(() => {
    stop?.()
    stop = undefined
    userAtom.set(null)
  })

  test('resets and refetches the list on a true account SWITCH (B after A)', async () => {
    userAtom.set(ALICE)
    stop = startNotebookListSync()
    resetSpy.mockClear()
    retrySpy.mockClear()

    userAtom.set(BOB) // switch account (A → B, no null between)
    await new Promise((resolve) => setTimeout(resolve))

    // Alice's editor slot and cached rows are dropped, then Bob's list is fetched
    // (the sidebar never unmounted across the switch, so its hot resource keeps
    // Alice's rows and won't refetch on its own — this retry refreshes it).
    expect(slotMock.resetSlotToFloorForAccountChange).toHaveBeenCalledTimes(1)
    expect(resetSpy).toHaveBeenCalledTimes(1)
    expect(retrySpy).toHaveBeenCalledTimes(1)
    // Ordering (H3): rows cleared synchronously and the slot reset BEFORE the new
    // account's list is fetched, so a foreign list never renders over the old slot.
    expect(resetSpy.mock.invocationCallOrder[0]).toBeLessThan(
      slotMock.resetSlotToFloorForAccountChange.mock.invocationCallOrder[0],
    )
    expect(slotMock.resetSlotToFloorForAccountChange.mock.invocationCallOrder[0]).toBeLessThan(
      retrySpy.mock.invocationCallOrder[0],
    )
  })

  test('does NOT refetch on the first sign-in null → user (sidebar re-subscribes and fetches) — №7', async () => {
    userAtom.set(null)
    stop = startNotebookListSync()
    resetSpy.mockClear()
    retrySpy.mockClear()

    userAtom.set(ALICE) // first sign-in within the session
    await new Promise((resolve) => setTimeout(resolve))

    // The slot is reset for the new owner and stale rows dropped, but the explicit
    // retry is skipped: NotebooksGroup unmounted while signed out, so on sign-in it
    // re-subscribes and the resource's own lazy fetch is the SINGLE source.
    // Retrying here too is the post-login double GET /notebooks (TARDIS-167 №7).
    expect(slotMock.resetSlotToFloorForAccountChange).toHaveBeenCalledTimes(1)
    expect(resetSpy).toHaveBeenCalledTimes(1)
    expect(retrySpy).not.toHaveBeenCalled()
  })

  test('resets but does not refetch on sign-out', async () => {
    userAtom.set(ALICE)
    stop = startNotebookListSync()
    resetSpy.mockClear()
    retrySpy.mockClear()

    userAtom.set(null) // sign out
    await new Promise((resolve) => setTimeout(resolve))

    expect(slotMock.resetSlotToFloorForAccountChange).toHaveBeenCalledTimes(1)
    expect(resetSpy).toHaveBeenCalledTimes(1)
    expect(retrySpy).not.toHaveBeenCalled()
  })

  test('does not reset or refetch on the initial subscribe (boot loads lazily)', async () => {
    userAtom.set(ALICE)
    stop = startNotebookListSync()
    await new Promise((resolve) => setTimeout(resolve))

    // The first synchronous emit is skipped — starting the sync touches nothing.
    expect(slotMock.resetSlotToFloorForAccountChange).not.toHaveBeenCalled()
    expect(resetSpy).not.toHaveBeenCalled()
    expect(retrySpy).not.toHaveBeenCalled()
  })

  test('ignores a redundant emit when the same account stays signed in', async () => {
    userAtom.set(ALICE)
    stop = startNotebookListSync()
    resetSpy.mockClear()
    retrySpy.mockClear()

    userAtom.set({ ...ALICE }) // same id, new object reference
    await new Promise((resolve) => setTimeout(resolve))

    expect(slotMock.resetSlotToFloorForAccountChange).not.toHaveBeenCalled()
    expect(resetSpy).not.toHaveBeenCalled()
    expect(retrySpy).not.toHaveBeenCalled()
  })

  test('loads only the lightweight list — never prefetches per-document GETs (AC2 / M6)', async () => {
    // AC2: sign-in bootstrap pulls the lightweight `GET /notebooks` list only;
    // full documents are fetched lazily on open. Pin the ABSENCE of a mass
    // prefetch so a future "warm documents on sign-in" refactor trips this test.
    const getSpy = vi.spyOn(notebookApi, 'get')
    userAtom.set(ALICE)
    stop = startNotebookListSync()
    userAtom.set(BOB) // account change triggers a list refetch (retry), not gets
    await new Promise((resolve) => setTimeout(resolve))

    expect(getSpy).not.toHaveBeenCalled()
  })
})
