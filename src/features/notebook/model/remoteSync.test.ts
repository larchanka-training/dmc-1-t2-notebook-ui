import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ApiError, NetworkError, notebook as notebookApi } from '@/shared/api'
import { accessTokenAtom } from '@/entities/session'
import { notebookStorage } from '../persistence/activeStorage'
import type { NotebookJSON } from '../persistence/schema'
import type { NotebookSyncState } from '../persistence/storageAdapter'
import { reatomCell } from '../domain/cell'
import { cellsAtom, LOCAL_NOTEBOOK_ID } from './notebook'
import { localSaveCommittedAtom } from './autosave'
import { isOnlineAtom } from './online'
import {
  INITIAL_RETRY_MS,
  pauseRemoteSync,
  pausedAtom,
  REMOTE_DEBOUNCE_MS,
  remoteSyncStatusAtom,
  startRemoteSync,
} from './remoteSync'

const CELL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CELL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function cell(id: string, content = 'x', updatedAt = 1): NotebookJSON['cells'][number] {
  return { id, kind: 'code', content, updatedAt }
}

function storedDoc(updatedAt: number, cells: NotebookJSON['cells']): NotebookJSON {
  return { formatVersion: 1, id: LOCAL_NOTEBOOK_ID, title: 'NB', createdAt: 1, updatedAt, cells }
}

function serverResponse(cells: notebookApi.NotebookCell[]): notebookApi.Notebook {
  return {
    id: LOCAL_NOTEBOOK_ID,
    title: 'NB',
    ownerId: 'owner-1',
    formatVersion: 1,
    createdAt: 1,
    updatedAt: 999,
    cells,
  }
}

const existingRemoteState: NotebookSyncState = {
  notebookId: LOCAL_NOTEBOOK_ID,
  remoteCreated: true,
  dirty: false,
  deletedCells: [],
}

function lastPersistedState(spy: ReturnType<typeof vi.spyOn>): NotebookSyncState {
  return spy.mock.calls.at(-1)?.[0] as NotebookSyncState
}

let teardown: (() => void) | undefined
let getSyncStateSpy: ReturnType<typeof vi.spyOn>
let putSyncStateSpy: ReturnType<typeof vi.spyOn>
let getSpy: ReturnType<typeof vi.spyOn>
let putIfNewerSpy: ReturnType<typeof vi.spyOn>
let createSpy: ReturnType<typeof vi.spyOn>
let patchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.useFakeTimers()
  accessTokenAtom.set('token')
  isOnlineAtom.set(true)
  pausedAtom.set(false)
  localSaveCommittedAtom.set(0)
  remoteSyncStatusAtom.set('idle')
  cellsAtom.set([reatomCell('x', 'code', CELL_A)])

  getSyncStateSpy = vi.spyOn(notebookStorage, 'getSyncState').mockResolvedValue(undefined)
  putSyncStateSpy = vi.spyOn(notebookStorage, 'putSyncState').mockResolvedValue()
  getSpy = vi.spyOn(notebookStorage, 'get').mockResolvedValue(storedDoc(5, [cell(CELL_A)]))
  putIfNewerSpy = vi.spyOn(notebookStorage, 'putIfNewer').mockResolvedValue({ ok: true })
  createSpy = vi.spyOn(notebookApi, 'create').mockResolvedValue(serverResponse([cell(CELL_A)]))
  patchSpy = vi.spyOn(notebookApi, 'patch').mockResolvedValue(serverResponse([cell(CELL_A)]))
})

afterEach(() => {
  teardown?.()
  teardown = undefined
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function commitAndFlush(): Promise<void> {
  localSaveCommittedAtom.set(localSaveCommittedAtom() + 1)
  await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS)
}

describe('remote sync engine', () => {
  test('debounces edits into a single POST on the first push', async () => {
    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)

    localSaveCommittedAtom.set(1)
    await vi.advanceTimersByTimeAsync(500)
    localSaveCommittedAtom.set(2)
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS)

    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(patchSpy).not.toHaveBeenCalled()
    // First push sends the full local document (INV-2), not an empty body.
    expect(createSpy.mock.calls[0][0]).toMatchObject({
      id: LOCAL_NOTEBOOK_ID,
      cells: [cell(CELL_A)],
    })
  })

  test('merges a local save recorded during sync-state load instead of dropping it (H-2)', async () => {
    let resolveGet!: (v: NotebookSyncState | undefined) => void
    getSyncStateSpy.mockReturnValue(
      new Promise<NotebookSyncState | undefined>((r) => {
        resolveGet = r
      }),
    )

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    // The sync-state load is still pending; a local save commits in that window.
    localSaveCommittedAtom.set(1)
    await vi.advanceTimersByTimeAsync(0)
    // The load now resolves with a CLEAN remote record.
    resolveGet({ ...existingRemoteState })
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS)

    // The provisional dirty change survived the merge and was pushed (old code
    // let the clean loaded record clobber it → no push).
    expect(patchSpy).toHaveBeenCalledTimes(1)
  })

  test('does not push when no user is signed in', async () => {
    accessTokenAtom.set(null)
    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)
    await commitAndFlush()

    expect(createSpy).not.toHaveBeenCalled()
    expect(patchSpy).not.toHaveBeenCalled()
  })

  test('flushes the queued change when the user signs in (review issue-1)', async () => {
    accessTokenAtom.set(null) // signed out
    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)

    // A signed-out edit commits → queued, but not pushed (engine idle).
    localSaveCommittedAtom.set(1)
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS)
    expect(createSpy).not.toHaveBeenCalled()

    // Signing in flushes the queue automatically.
    accessTokenAtom.set('fresh-token')
    await vi.advanceTimersByTimeAsync(0)
    expect(createSpy).toHaveBeenCalledTimes(1)
  })

  test('PATCHes an existing notebook and sends a tombstone for a deleted cell', async () => {
    getSyncStateSpy.mockResolvedValue({ ...existingRemoteState })
    cellsAtom.set([reatomCell('x', 'code', CELL_A), reatomCell('x', 'code', CELL_B)])

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)

    // Delete cell B locally, then a local save commits.
    cellsAtom.set([reatomCell('x', 'code', CELL_A)])
    await commitAndFlush()

    expect(createSpy).not.toHaveBeenCalled()
    expect(patchSpy).toHaveBeenCalledTimes(1)
    expect(patchSpy.mock.calls[0][1].deletedCells).toEqual([
      { id: CELL_B, deletedAt: expect.any(Number) },
    ])
  })

  test('retracts a tombstone when a deleted cell is undone before the push (H-1)', async () => {
    getSyncStateSpy.mockResolvedValue({ ...existingRemoteState })
    getSpy.mockResolvedValue(storedDoc(5, [cell(CELL_A), cell(CELL_B)]))
    cellsAtom.set([reatomCell('x', 'code', CELL_A), reatomCell('x', 'code', CELL_B)])

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)

    // Delete cell B, commit (no push yet — still inside the debounce window)...
    cellsAtom.set([reatomCell('x', 'code', CELL_A)])
    localSaveCommittedAtom.set(1)
    await vi.advanceTimersByTimeAsync(100)
    // ...then undo: cell B is restored with the same id, commit.
    cellsAtom.set([reatomCell('x', 'code', CELL_A), reatomCell('x', 'code', CELL_B)])
    localSaveCommittedAtom.set(2)
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS)

    // One PATCH, and it must NOT carry a tombstone for the restored cell.
    expect(patchSpy).toHaveBeenCalledTimes(1)
    expect(patchSpy.mock.calls[0][1].deletedCells).toEqual([])
  })

  test('keeps deletedCells after a failed PATCH and drops them after success', async () => {
    getSyncStateSpy.mockResolvedValue({ ...existingRemoteState })
    cellsAtom.set([reatomCell('x', 'code', CELL_A), reatomCell('x', 'code', CELL_B)])
    patchSpy.mockRejectedValueOnce(new NetworkError('offline'))

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)
    cellsAtom.set([reatomCell('x', 'code', CELL_A)])
    await commitAndFlush()

    // First PATCH failed: the tombstone is still queued (persisted, not dropped).
    expect(patchSpy).toHaveBeenCalledTimes(1)
    expect(lastPersistedState(putSyncStateSpy).deletedCells).toHaveLength(1)
    expect(remoteSyncStatusAtom()).toBe('offline')

    // Backoff retry succeeds → the acked tombstone is dropped.
    patchSpy.mockResolvedValue(serverResponse([cell(CELL_A)]))
    await vi.advanceTimersByTimeAsync(INITIAL_RETRY_MS)
    expect(patchSpy).toHaveBeenCalledTimes(2)
    expect(lastPersistedState(putSyncStateSpy).deletedCells).toEqual([])
  })

  test('adopts the merged server response as the new baseline when local is clean', async () => {
    let current = storedDoc(5, [cell(CELL_A, 'local', 5)])
    getSpy.mockImplementation(async () => current)
    putIfNewerSpy.mockImplementation(async (nb: NotebookJSON) => {
      current = nb
      return { ok: true }
    })
    getSyncStateSpy.mockResolvedValue({ ...existingRemoteState })
    patchSpy.mockResolvedValue(serverResponse([cell(CELL_A, 'merged-from-server', 10)]))
    cellsAtom.set([reatomCell('local', 'code', CELL_A, 5)])

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)
    await commitAndFlush()

    expect(patchSpy).toHaveBeenCalledTimes(1)
    // Applied to local storage (baseline) and to in-memory cells.
    expect(current.cells[0].content).toBe('merged-from-server')
    expect(cellsAtom()[0].code()).toBe('merged-from-server')
    expect(remoteSyncStatusAtom()).toBe('synced')
  })

  test('does not adopt the merged response when a newer save commits in flight', async () => {
    let current = storedDoc(5, [cell(CELL_A, 'local', 5)])
    getSpy.mockImplementation(async () => current)
    putIfNewerSpy.mockImplementation(async (nb: NotebookJSON) => {
      current = nb
      return { ok: true }
    })
    getSyncStateSpy.mockResolvedValue({ ...existingRemoteState })
    patchSpy
      .mockImplementationOnce(async () => {
        // User saves again while the first PATCH is in flight.
        localSaveCommittedAtom.set(localSaveCommittedAtom() + 1)
        return serverResponse([cell(CELL_A, 'server-1', 10)])
      })
      .mockResolvedValue(serverResponse([cell(CELL_A, 'server-2', 20)]))
    cellsAtom.set([reatomCell('local', 'code', CELL_A, 5)])

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)
    await commitAndFlush()

    // First push skips apply (stale) and re-pushes; the second applies cleanly.
    expect(patchSpy).toHaveBeenCalledTimes(2)
    expect(cellsAtom()[0].code()).toBe('server-2')
  })

  test('refuses an empty-cells response that would zero a non-empty notebook (M-3)', async () => {
    getSpy.mockResolvedValue(storedDoc(5, [cell(CELL_A, 'local', 5)]))
    getSyncStateSpy.mockResolvedValue({ ...existingRemoteState })
    patchSpy.mockResolvedValue(serverResponse([])) // server returns 0 cells
    cellsAtom.set([reatomCell('local', 'code', CELL_A, 5)])

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)
    await commitAndFlush()

    // The notebook is NOT zeroed — adoption refused, local kept, storage untouched.
    expect(cellsAtom()[0].code()).toBe('local')
    expect(putIfNewerSpy).not.toHaveBeenCalled()
    expect(remoteSyncStatusAtom()).toBe('error')
  })

  test('refuses baseline adoption when storage holds a newer version (M-1 CAS)', async () => {
    getSpy.mockResolvedValue(storedDoc(5, [cell(CELL_A, 'local', 5)]))
    getSyncStateSpy.mockResolvedValue({ ...existingRemoteState })
    patchSpy.mockResolvedValue(serverResponse([cell(CELL_A, 'server', 10)]))
    // Another tab wrote a newer version since this push's baseline.
    putIfNewerSpy.mockResolvedValue({
      ok: false,
      current: storedDoc(99, [cell(CELL_A, 'other-tab', 99)]),
    })
    cellsAtom.set([reatomCell('local', 'code', CELL_A, 5)])

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)
    await commitAndFlush()

    // The newer stored version is not clobbered; the editor is not reloaded to the
    // server doc, and the change stays dirty for a re-push.
    expect(cellsAtom()[0].code()).toBe('local')
    expect(lastPersistedState(putSyncStateSpy).dirty).toBe(true)
  })

  test('does not push while offline and flushes on reconnect', async () => {
    isOnlineAtom.set(false)
    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)
    await commitAndFlush()

    expect(createSpy).not.toHaveBeenCalled()
    expect(remoteSyncStatusAtom()).toBe('offline')

    isOnlineAtom.set(true)
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)

    expect(createSpy).toHaveBeenCalledTimes(1)
  })

  test('treats a 401 reaching the facade as a retryable failure, not session end', async () => {
    createSpy.mockRejectedValueOnce(new ApiError(401, 'invalid_token'))
    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)
    await commitAndFlush()

    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(pausedAtom()).toBe(false) // the engine never pauses itself on a 401
    expect(remoteSyncStatusAtom()).toBe('error')

    createSpy.mockResolvedValue(serverResponse([cell(CELL_A)]))
    await vi.advanceTimersByTimeAsync(INITIAL_RETRY_MS)
    expect(createSpy).toHaveBeenCalledTimes(2)
  })

  test('a repeated start does not leave a duplicate save subscription (H-3)', async () => {
    startRemoteSync(LOCAL_NOTEBOOK_ID) // first engine
    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID) // restart (e.g. #135 re-login)
    await vi.advanceTimersByTimeAsync(0)

    putSyncStateSpy.mockClear()
    localSaveCommittedAtom.set(1)
    await vi.advanceTimersByTimeAsync(0)

    // Only one live subscription should react → one dirty-state persist (a leaked
    // first subscription would fire too, persisting twice).
    expect(putSyncStateSpy).toHaveBeenCalledTimes(1)
  })

  test('pauseRemoteSync stops pushes without wiping local data', async () => {
    const clearAllSpy = vi.spyOn(notebookStorage, 'clearAll')
    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)

    pauseRemoteSync()
    await commitAndFlush()

    expect(createSpy).not.toHaveBeenCalled()
    expect(pausedAtom()).toBe(true)
    expect(remoteSyncStatusAtom()).toBe('paused')
    expect(clearAllSpy).not.toHaveBeenCalled()
  })
})
