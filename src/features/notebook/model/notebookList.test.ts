import { peek } from '@reatom/core'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ApiError, notebook as notebookApi } from '@/shared/api'
import { userAtom } from '@/entities/session'
import * as idLib from '@/shared/lib/id'
import { notebookStorage } from '../persistence/activeStorage'
import { FORMAT_VERSION } from '../persistence/schema'
import { activeNotebookIdAtom, LOCAL_NOTEBOOK_ID } from './notebook'
import {
  createNotebookAction,
  deleteNotebookAction,
  notebookListResource,
  startNotebookListSync,
} from './notebookList'

// Delete vacates the slot via the slot controller when the deleted notebook is
// open. Mock it so this suite asserts the delete action's own orchestration
// (slot vacate → optimistic row removal → server DELETE → local cleanup) without
// booting the real autosave/remote-sync/AI bindings the controller starts.
const slotMock = vi.hoisted(() => ({ degradeSlotToFloor: vi.fn() }))
vi.mock('./slot', () => ({ degradeSlotToFloor: slotMock.degradeSlotToFloor }))

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
    expect(result).toEqual(created)
    expect(peek(notebookListResource.data)).toEqual([existing, listItem(CLIENT_ID, 'new')])
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
})

describe('deleteNotebookAction', () => {
  const NB_ID = '55555555-5555-4555-8555-555555555555'

  beforeEach(() => {
    slotMock.degradeSlotToFloor.mockResolvedValue(undefined)
    vi.spyOn(notebookStorage, 'delete').mockResolvedValue()
    vi.spyOn(notebookStorage, 'deleteSyncState').mockResolvedValue()
    activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
  })

  afterEach(() => {
    activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
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
    // Not the active notebook → the slot is left alone.
    expect(slotMock.degradeSlotToFloor).not.toHaveBeenCalled()
  })

  test('rolls the row back when the server DELETE fails', async () => {
    const other = listItem('keep', 'Keep me')
    notebookListResource.data.set([other, listItem(NB_ID, 'Doomed')])
    vi.spyOn(notebookApi, 'remove').mockRejectedValue(new ApiError(500, 'boom', 'boom'))

    await expect(deleteNotebookAction(NB_ID)).rejects.toThrow()
    // The optimistic removal is rolled back: the row is still present.
    expect(peek(notebookListResource.data)).toEqual([other, listItem(NB_ID, 'Doomed')])
  })

  test('vacates the slot first when deleting the active notebook', async () => {
    activeNotebookIdAtom.set(NB_ID) // the doomed notebook is open in the slot
    notebookListResource.data.set([listItem(NB_ID, 'Doomed')])
    const removeSpy = vi.spyOn(notebookApi, 'remove').mockResolvedValue()

    await deleteNotebookAction(NB_ID)

    // Slot degraded to the floor BEFORE the server delete, so its bindings cannot
    // recreate the id mid-delete.
    expect(slotMock.degradeSlotToFloor).toHaveBeenCalledTimes(1)
    const degradeOrder = slotMock.degradeSlotToFloor.mock.invocationCallOrder[0]
    const removeOrder = removeSpy.mock.invocationCallOrder[0]
    expect(degradeOrder).toBeLessThan(removeOrder)
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

  test('resets and refetches the list when the account changes within a session', async () => {
    userAtom.set(ALICE)
    stop = startNotebookListSync()
    resetSpy.mockClear()
    retrySpy.mockClear()

    userAtom.set(BOB) // switch account
    await Promise.resolve()

    // Alice's cached rows are dropped, then Bob's list is fetched.
    expect(resetSpy).toHaveBeenCalledTimes(1)
    expect(retrySpy).toHaveBeenCalledTimes(1)
  })

  test('resets but does not refetch on sign-out', async () => {
    userAtom.set(ALICE)
    stop = startNotebookListSync()
    resetSpy.mockClear()
    retrySpy.mockClear()

    userAtom.set(null) // sign out
    await Promise.resolve()

    expect(resetSpy).toHaveBeenCalledTimes(1)
    expect(retrySpy).not.toHaveBeenCalled()
  })

  test('does not reset or refetch on the initial subscribe (boot loads lazily)', async () => {
    userAtom.set(ALICE)
    stop = startNotebookListSync()
    await Promise.resolve()

    // The first synchronous emit is skipped — starting the sync touches nothing.
    expect(resetSpy).not.toHaveBeenCalled()
    expect(retrySpy).not.toHaveBeenCalled()
  })

  test('ignores a redundant emit when the same account stays signed in', async () => {
    userAtom.set(ALICE)
    stop = startNotebookListSync()
    resetSpy.mockClear()
    retrySpy.mockClear()

    userAtom.set({ ...ALICE }) // same id, new object reference
    await Promise.resolve()

    expect(resetSpy).not.toHaveBeenCalled()
    expect(retrySpy).not.toHaveBeenCalled()
  })
})
