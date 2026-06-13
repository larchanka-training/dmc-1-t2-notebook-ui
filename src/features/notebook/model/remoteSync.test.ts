import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ApiError, NetworkError, notebook as notebookApi, RateLimitedError } from '@/shared/api'
import { accessTokenAtom, userAtom } from '@/entities/session'
import { notebookStorage } from '../persistence/activeStorage'
import type { NotebookJSON } from '../persistence/schema'
import type { NotebookSyncState } from '../persistence/storageAdapter'
import { reatomCell } from '../domain/cell'
import {
  cellsAtom,
  LOCAL_NOTEBOOK_ID,
  notebookBaseUpdatedAtAtom,
  restoreNotebook,
} from './notebook'
import { bumpNotebookRevision, notebookRevisionAtom } from './revision'
import { localSaveCommittedAtom } from './autosave'
import { isOnlineAtom } from './online'
import {
  INITIAL_RETRY_MS,
  pauseRemoteSync,
  pausedAtom,
  PERSIST_RETRY_MS,
  REMOTE_DEBOUNCE_MS,
  remoteSyncStatusAtom,
  startRemoteSync,
} from './remoteSync'

const CELL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CELL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
// Well past the engine's capped (60s) retry backoff — proves no retry is armed.
const MAX_RETRY_WAIT = 120_000

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

const ALICE = '11111111-1111-4111-8111-111111111111'
const BOB = '22222222-2222-4222-8222-222222222222'
// Default signed-in user for the common tests (the owner-gate now requires a
// concrete attributable user; account-specific tests override userAtom).
const OWNER = '33333333-3333-4333-8333-333333333333'

function user(id: string): ReturnType<typeof userAtom> {
  return { id, roles: [] }
}

const existingRemoteState: NotebookSyncState = {
  notebookId: LOCAL_NOTEBOOK_ID,
  remoteCreated: true,
  dirty: false,
  ownerId: OWNER, // attributed to the default signed-in user
  deletedCells: [],
  // Matches the stored docs these tests use (updatedAt 5), so the C-4 boot
  // detection does not fire a spurious extra push; C-4's own tests override it.
  lastSyncedUpdatedAt: 5,
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
  userAtom.set(user(OWNER))
  isOnlineAtom.set(true)
  pausedAtom.set(false)
  localSaveCommittedAtom.set(0)
  remoteSyncStatusAtom.set('idle')
  cellsAtom.set([reatomCell('x', 'code', CELL_A)])

  // Failure-path tests intentionally log; suppress the expected warn/info noise so
  // CI output stays readable (review veai C3). Tests that assert a log spy locally.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})

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

  test('re-pushes on boot when stored content is newer than the synced watermark (review C-4)', async () => {
    // Previously synced at updatedAt 5, but local storage holds newer content (10)
    // and the dirty flag was lost (crash before it persisted).
    getSyncStateSpy.mockResolvedValue({
      ...existingRemoteState,
      lastSyncedUpdatedAt: 5,
    })
    getSpy.mockResolvedValue(storedDoc(10, [cell(CELL_A, 'unsynced', 10)]))

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    // No edit/commit — boot detection alone must trigger the push.
    await vi.advanceTimersByTimeAsync(0)
    expect(patchSpy).toHaveBeenCalledTimes(1)
  })

  test('does not boot-push when stored content matches the synced watermark', async () => {
    getSyncStateSpy.mockResolvedValue({
      ...existingRemoteState,
      lastSyncedUpdatedAt: 10,
    })
    getSpy.mockResolvedValue(storedDoc(10, [cell(CELL_A, 'synced', 10)]))

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS)
    expect(patchSpy).not.toHaveBeenCalled()
  })

  test('does not push when no user is signed in', async () => {
    accessTokenAtom.set(null)
    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)
    await commitAndFlush()

    expect(createSpy).not.toHaveBeenCalled()
    expect(patchSpy).not.toHaveBeenCalled()
  })

  test('flags an owner conflict on a cross-owner load race and never auto-pushes it (review gpt A-1)', async () => {
    // Alice's durable dirty queue resolves slowly...
    let resolveGet!: (v: NotebookSyncState | undefined) => void
    getSyncStateSpy.mockReturnValue(
      new Promise<NotebookSyncState | undefined>((r) => {
        resolveGet = r
      }),
    )
    userAtom.set(user(BOB)) // ...while Bob is signed in and commits during the load.

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    localSaveCommittedAtom.set(1) // Bob's provisional edit → ownerId BOB
    await vi.advanceTimersByTimeAsync(0)

    resolveGet({
      notebookId: LOCAL_NOTEBOOK_ID,
      remoteCreated: true,
      dirty: true,
      ownerId: ALICE,
      deletedCells: [],
    })
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS)

    // The merge flags a conflict; nothing is uploaded under Bob.
    expect(createSpy).not.toHaveBeenCalled()
    expect(patchSpy).not.toHaveBeenCalled()
    expect(lastPersistedState(putSyncStateSpy).ownerConflict).toBe(true)

    // The conflict is persistent — even Alice signing in cannot auto-push it.
    userAtom.set(user(ALICE))
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS)
    expect(patchSpy).not.toHaveBeenCalled()
  })

  test('does NOT push a queued change that belongs to another account (review veai Critical)', async () => {
    // A persisted dirty queue left by Alice (e.g. she edited offline then logged
    // out — the queue survives logout)...
    getSyncStateSpy.mockResolvedValue({
      notebookId: LOCAL_NOTEBOOK_ID,
      remoteCreated: false,
      dirty: true,
      ownerId: ALICE,
      deletedCells: [],
    })
    // ...but Bob is the one signed in now.
    userAtom.set(user(BOB))

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS)

    // The boot-flush is refused — Alice's notebook is never uploaded under Bob.
    expect(createSpy).not.toHaveBeenCalled()
    expect(patchSpy).not.toHaveBeenCalled()
  })

  test('flushes a same-owner queue once the user identity hydrates (review A-3)', async () => {
    // Token present (beforeEach), but user not hydrated yet (/auth/me in flight).
    userAtom.set(null)
    getSyncStateSpy.mockResolvedValue({
      notebookId: LOCAL_NOTEBOOK_ID,
      remoteCreated: true,
      dirty: true,
      ownerId: ALICE,
      deletedCells: [],
    })

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)
    // Owner-gate rejected the push (currentOwnerId undefined ≠ ALICE).
    expect(patchSpy).not.toHaveBeenCalled()

    // The user hydrates to the queue's owner → the flush is re-attempted.
    userAtom.set(user(ALICE))
    await vi.advanceTimersByTimeAsync(0)
    expect(patchSpy).toHaveBeenCalledTimes(1)
  })

  test('attributes and flushes a token-present/user-null save once identity hydrates (review gpt-v-7 A-1)', async () => {
    // Token present (beforeEach), user not hydrated yet, and NO durable queue — so
    // the edit is recorded in-memory with no ownerId. The owner-gate would strand
    // it forever (the hydration retry only re-runs pushNow) until A-1's re-stamp.
    userAtom.set(null)

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await commitAndFlush() // a local edit commits while the user is unknown
    expect(createSpy).not.toHaveBeenCalled() // no attributable owner yet

    // Identity hydrates for the SAME session → attribute the queue and flush,
    // without waiting for another edit.
    userAtom.set(user(ALICE))
    await vi.advanceTimersByTimeAsync(0)

    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(lastPersistedState(putSyncStateSpy).ownerId).toBe(ALICE)
  })

  test('does NOT attribute a token-present/user-null save to a user who signs in after a sign-out (review gpt-v-7 A-1)', async () => {
    // A save made in the token-present/user-null window, then a sign-out, then a
    // DIFFERENT user signs in. The unattributed queue must NOT be auto-pushed
    // under the new account (cross-account safety): the pending flag is cleared on
    // sign-out, so the owner-gate keeps refusing it.
    userAtom.set(null)

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await commitAndFlush()
    expect(createSpy).not.toHaveBeenCalled()

    // Sign-out clears the pending attribution, then Bob signs in.
    accessTokenAtom.set(null)
    await vi.advanceTimersByTimeAsync(0)
    accessTokenAtom.set('bob-token')
    userAtom.set(user(BOB))
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS)

    expect(createSpy).not.toHaveBeenCalled() // still unattributed, never under Bob
  })

  test('pushes a queued change that belongs to the current account', async () => {
    getSyncStateSpy.mockResolvedValue({
      notebookId: LOCAL_NOTEBOOK_ID,
      remoteCreated: false,
      dirty: true,
      ownerId: ALICE,
      deletedCells: [],
    })
    userAtom.set(user(ALICE)) // same account

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)

    expect(createSpy).toHaveBeenCalledTimes(1)
  })

  test('flushes a queue attributed to the signing-in user on re-login (review issue-1)', async () => {
    // Alice's attributed queue, session expired (token + user cleared).
    getSyncStateSpy.mockResolvedValue({ ...existingRemoteState, dirty: true, ownerId: ALICE })
    accessTokenAtom.set(null)
    userAtom.set(null)

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)
    expect(patchSpy).not.toHaveBeenCalled() // signed out

    // Re-login as Alice → her attributed queue flushes.
    userAtom.set(user(ALICE))
    accessTokenAtom.set('fresh-token')
    await vi.advanceTimersByTimeAsync(0)
    expect(patchSpy).toHaveBeenCalledTimes(1)
  })

  test('does NOT auto-upload a signed-out (unattributed) edit on sign-in (review gpt High)', async () => {
    accessTokenAtom.set(null)
    userAtom.set(null) // truly signed out — no identity to attribute the edit to
    getSyncStateSpy.mockResolvedValue(undefined)

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)
    localSaveCommittedAtom.set(1) // signed-out edit → ownerId stays undefined
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS)
    expect(createSpy).not.toHaveBeenCalled()

    // A DIFFERENT user signs in — the unattributed queue must not upload under them.
    userAtom.set(user(BOB))
    accessTokenAtom.set('bob-token')
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS)
    expect(createSpy).not.toHaveBeenCalled()
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

  test('a cell from a cross-tab reload still produces a tombstone when deleted (review veai High)', async () => {
    getSyncStateSpy.mockResolvedValue({ ...existingRemoteState })
    cellsAtom.set([reatomCell('x', 'code', CELL_A)]) // engine starts knowing only A

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)

    // A cross-tab pull replaces the editor with A + B (restoreNotebook bumps the
    // restore signal, which re-seeds the delete-detection baseline to {A, B}).
    restoreNotebook(storedDoc(6, [cell(CELL_A), cell(CELL_B)]))
    await vi.advanceTimersByTimeAsync(0)

    // Now delete B and commit.
    cellsAtom.set([reatomCell('x', 'code', CELL_A)])
    localSaveCommittedAtom.set(1)
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS)

    // B's deletion is detected and sent as a tombstone (without the re-seed it
    // would be missed and B could resurrect on the server).
    expect(patchSpy).toHaveBeenCalledTimes(1)
    expect(patchSpy.mock.calls[0][1].deletedCells).toEqual([
      { id: CELL_B, deletedAt: expect.any(Number) },
    ])
  })

  test('does not send a tombstone for a cell still in the pushed document (review C-1)', async () => {
    // A tombstone for B is queued, but the persisted doc still contains B (the
    // deletion was made in-memory and its own save has not committed yet).
    getSyncStateSpy.mockResolvedValue({
      notebookId: LOCAL_NOTEBOOK_ID,
      remoteCreated: true,
      dirty: true,
      ownerId: OWNER,
      deletedCells: [{ id: CELL_B, deletedAt: 100 }],
      lastSyncedUpdatedAt: 5,
    })
    getSpy.mockResolvedValue(storedDoc(6, [cell(CELL_A), cell(CELL_B)]))

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)

    expect(patchSpy).toHaveBeenCalledTimes(1)
    // B is in the body, so no contradictory tombstone is sent for it.
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

  test('persists the lastSyncedUpdatedAt watermark after a successful push (review veai C4)', async () => {
    getSyncStateSpy.mockResolvedValue(undefined) // first push → POST
    getSpy.mockResolvedValue(storedDoc(7, [cell(CELL_A)]))
    // create returns the merged doc with updatedAt 999 (serverResponse default).

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)
    await commitAndFlush()

    expect(createSpy).toHaveBeenCalledTimes(1)
    // The watermark boot-detection relies on this being persisted from the merged
    // response — a refactor dropping it would otherwise pass the (injected) boot tests.
    expect(lastPersistedState(putSyncStateSpy).lastSyncedUpdatedAt).toBe(999)
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

  test('refuses a server response whose id does not match the notebook (review C-6)', async () => {
    getSpy.mockResolvedValue(storedDoc(5, [cell(CELL_A, 'local', 5)]))
    getSyncStateSpy.mockResolvedValue({ ...existingRemoteState })
    // The (otherwise valid) response echoes a different id.
    patchSpy.mockResolvedValue({ ...serverResponse([cell(CELL_A, 'server', 10)]), id: CELL_B })
    cellsAtom.set([reatomCell('local', 'code', CELL_A, 5)])

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)
    await commitAndFlush()

    // No phantom record written under the wrong id; the local notebook is untouched.
    expect(putIfNewerSpy).not.toHaveBeenCalled()
    expect(cellsAtom()[0].code()).toBe('local')
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

  test('advances the autosave base when a keystroke lands during adoption (review C-3)', async () => {
    getSyncStateSpy.mockResolvedValue({ ...existingRemoteState })
    getSpy.mockResolvedValue(storedDoc(5, [cell(CELL_A, 'local', 5)]))
    cellsAtom.set([reatomCell('local', 'code', CELL_A, 5)])
    patchSpy.mockResolvedValue(serverResponse([cell(CELL_A, 'server', 10)])) // updatedAt 999
    notebookBaseUpdatedAtAtom.set(5)
    // Clean on entry (revision == savedRevision); restore it afterwards so the
    // bump below does not leak hasLocalChanges into the next test.
    const cleanRevision = notebookRevisionAtom()
    // Simulate a keystroke landing during the storage write.
    putIfNewerSpy.mockImplementation(async () => {
      bumpNotebookRevision()
      return { ok: true }
    })

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)
    await commitAndFlush()

    // Base advanced to the written server version (999) so the pending autosave
    // saves the keystroke cleanly instead of a false CAS conflict.
    expect(notebookBaseUpdatedAtAtom()).toBe(999)

    notebookRevisionAtom.set(cleanRevision)
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

  test('retries a 5xx with backoff and succeeds (review L-10)', async () => {
    createSpy.mockRejectedValueOnce(new ApiError(503, 'unavailable'))
    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)
    await commitAndFlush()

    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(remoteSyncStatusAtom()).toBe('error')

    createSpy.mockResolvedValue(serverResponse([cell(CELL_A)]))
    await vi.advanceTimersByTimeAsync(INITIAL_RETRY_MS)
    expect(createSpy).toHaveBeenCalledTimes(2)
  })

  test('recovers from a lost create-ack: a 409 on re-POST switches to PATCH (review C-1/C-2)', async () => {
    getSyncStateSpy.mockResolvedValue(undefined) // remoteCreated = false
    getSpy.mockResolvedValue(storedDoc(5, [cell(CELL_A, 'edited-after-lost-ack', 5)]))
    // The original POST committed server-side but its ack was lost; the re-POST
    // (different content after an edit) gets a 409 NOTEBOOK_CONFLICT.
    createSpy.mockRejectedValue(new ApiError(409, 'notebook_conflict'))
    patchSpy.mockResolvedValue(serverResponse([cell(CELL_A, 'edited-after-lost-ack', 5)]))

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)
    await commitAndFlush()

    // Instead of wedging on a terminal 'failed', the engine adopts the notebook as
    // created and re-pushes via PATCH — the sync recovers.
    expect(createSpy).toHaveBeenCalled()
    expect(patchSpy).toHaveBeenCalledTimes(1)
    expect(remoteSyncStatusAtom()).toBe('synced')
    expect(lastPersistedState(putSyncStateSpy).remoteCreated).toBe(true)
  })

  test('refuses to push a notebook exceeding the 500-cell server cap (review opus M3)', async () => {
    getSyncStateSpy.mockResolvedValue({ ...existingRemoteState, dirty: true })
    getSpy.mockResolvedValue(
      storedDoc(
        5,
        Array.from({ length: 501 }, (_, i) => cell(`c-${i}`)),
      ),
    )

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)

    // Refused client-side (a distinct 'failed'), never sent to be 422'd and wedged.
    expect(patchSpy).not.toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
    expect(remoteSyncStatusAtom()).toBe('failed')
  })

  test('refuses to push when the tombstone buffer exceeds the cap (review gpt B-2)', async () => {
    const manyTombstones = Array.from({ length: 1001 }, (_, i) => ({
      id: `tombstone-${i}`,
      deletedAt: i + 1,
    }))
    getSyncStateSpy.mockResolvedValue({
      ...existingRemoteState,
      dirty: true,
      deletedCells: manyTombstones,
    })

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)

    // Refused client-side (terminal) instead of building a pathological PATCH body.
    expect(patchSpy).not.toHaveBeenCalled()
    expect(remoteSyncStatusAtom()).toBe('failed')
  })

  test('refuses a push whose title exceeds the backend limit (review B-3)', async () => {
    getSyncStateSpy.mockResolvedValue({ ...existingRemoteState, dirty: true })
    getSpy.mockResolvedValue({ ...storedDoc(5, [cell(CELL_A)]), title: 'x'.repeat(256) })

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)

    expect(patchSpy).not.toHaveBeenCalled()
    expect(remoteSyncStatusAtom()).toBe('failed')
  })

  test('does not report synced when the editor reload fails during adoption (review A-2)', async () => {
    getSyncStateSpy.mockResolvedValue({ ...existingRemoteState, dirty: true })
    cellsAtom.set([reatomCell('local', 'code', CELL_A, 5)])
    // Push read succeeds; the adoption reload read then fails.
    getSpy
      .mockResolvedValueOnce(storedDoc(5, [cell(CELL_A, 'local', 5)]))
      .mockRejectedValue(new Error('blocked db'))
    patchSpy.mockResolvedValue(serverResponse([cell(CELL_A, 'merged', 10)]))

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)

    expect(patchSpy).toHaveBeenCalledTimes(1)
    // Adoption deferred (reload failed) — never reports a false 'synced'.
    expect(remoteSyncStatusAtom()).not.toBe('synced')
  })

  test('does NOT loop on a permanent 4xx; keeps the queue and goes terminal (review M-2)', async () => {
    // A shared-id 403 (C0) lands here: the body is rejected every time.
    createSpy.mockRejectedValue(new ApiError(403, 'forbidden'))
    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)
    await commitAndFlush()

    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(remoteSyncStatusAtom()).toBe('failed')
    // No retry is armed — advancing well past any backoff issues no further call.
    await vi.advanceTimersByTimeAsync(MAX_RETRY_WAIT)
    expect(createSpy).toHaveBeenCalledTimes(1)
    // The change is NOT lost — it stays queued (dirty) for a future opportunity.
    expect(lastPersistedState(putSyncStateSpy).dirty).toBe(true)
  })

  test('retries persisting dirty sync metadata when the write fails (review A-4)', async () => {
    isOnlineAtom.set(false) // keep the network push out of the persist-count
    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    putSyncStateSpy.mockClear()
    putSyncStateSpy.mockRejectedValueOnce(new Error('quota exceeded'))

    localSaveCommittedAtom.set(1)
    await vi.advanceTimersByTimeAsync(0)
    // The first persist failed and was logged (not silently swallowed).
    expect(putSyncStateSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalled()

    // The scheduled retry persists the dirty state durably.
    putSyncStateSpy.mockResolvedValue()
    await vi.advanceTimersByTimeAsync(PERSIST_RETRY_MS)
    expect(putSyncStateSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  test('honours a 429 Retry-After before retrying (review C-5)', async () => {
    // retryAfter 5s — longer than the 2s initial backoff floor.
    createSpy.mockRejectedValueOnce(new RateLimitedError('rate_limited', 'slow down', 5))
    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)
    await commitAndFlush()
    expect(createSpy).toHaveBeenCalledTimes(1)

    // At the 2s backoff floor the server's 5s hint is not yet satisfied — no retry.
    await vi.advanceTimersByTimeAsync(INITIAL_RETRY_MS)
    expect(createSpy).toHaveBeenCalledTimes(1)

    createSpy.mockResolvedValue(serverResponse([cell(CELL_A)]))
    await vi.advanceTimersByTimeAsync(5000 - INITIAL_RETRY_MS)
    expect(createSpy).toHaveBeenCalledTimes(2)
  })

  test('grows the retry backoff between attempts (review C-5)', async () => {
    createSpy.mockRejectedValue(new ApiError(503, 'unavailable'))
    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)
    await commitAndFlush() // push #1 fails → retry armed at +2000

    expect(createSpy).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(INITIAL_RETRY_MS) // retry #2 fires → next backoff 4000
    expect(createSpy).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(INITIAL_RETRY_MS) // +2000: not enough for the grown 4000
    expect(createSpy).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(INITIAL_RETRY_MS) // +2000 more → retry #3
    expect(createSpy).toHaveBeenCalledTimes(3)
  })

  test('discards an in-flight push result when paused mid-request (review C-5)', async () => {
    getSyncStateSpy.mockResolvedValue(undefined)
    let resolveCreate!: (nb: notebookApi.Notebook) => void
    createSpy.mockReturnValue(
      new Promise<notebookApi.Notebook>((r) => {
        resolveCreate = r
      }),
    )

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)
    localSaveCommittedAtom.set(1)
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS)
    expect(createSpy).toHaveBeenCalledTimes(1) // request in flight

    putSyncStateSpy.mockClear()
    pauseRemoteSync() // bumps generation
    resolveCreate(serverResponse([cell(CELL_A)])) // response arrives AFTER pause
    await vi.advanceTimersByTimeAsync(0)

    // The post-await generation check discards it — no state mutation or adoption.
    expect(putSyncStateSpy).not.toHaveBeenCalled()
    expect(putIfNewerSpy).not.toHaveBeenCalled()
    expect(pausedAtom()).toBe(true)
  })

  test('does not clobber the durable queue when sync-metadata read fails (review A-1)', async () => {
    isOnlineAtom.set(false) // keep pushes out of the putSyncState count
    const durable: NotebookSyncState = {
      notebookId: LOCAL_NOTEBOOK_ID,
      remoteCreated: true,
      dirty: true,
      deletedCells: [{ id: CELL_B, deletedAt: 100 }],
      lastSyncedUpdatedAt: 5,
    }
    // First metadata read fails; the retry succeeds with the durable record.
    getSyncStateSpy.mockRejectedValueOnce(new Error('blocked db')).mockResolvedValue(durable)

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0) // load fails → retry armed, metadata not loaded

    // A local save commits during the failure window — it must NOT persist a fresh
    // provisional state over the unread durable queue.
    putSyncStateSpy.mockClear()
    localSaveCommittedAtom.set(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(putSyncStateSpy).not.toHaveBeenCalled()

    // The load retry succeeds → merge preserves remoteCreated + the durable tombstone
    // AND the new dirty flag (nothing lost).
    await vi.advanceTimersByTimeAsync(INITIAL_RETRY_MS)
    const persisted = lastPersistedState(putSyncStateSpy)
    expect(persisted.remoteCreated).toBe(true)
    expect(persisted.dirty).toBe(true)
    expect(persisted.deletedCells).toEqual([{ id: CELL_B, deletedAt: 100 }])
  })

  test('classifies a transient local-read failure as retryable, not unhandled (review veai High)', async () => {
    getSyncStateSpy.mockResolvedValue({ ...existingRemoteState, dirty: true })
    getSpy.mockRejectedValueOnce(new Error('blocked db'))

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0) // boot-flush (dirty) → get rejects

    expect(remoteSyncStatusAtom()).toBe('error')
    expect(createSpy).not.toHaveBeenCalled()
    expect(patchSpy).not.toHaveBeenCalled()

    // The retry re-reads successfully and pushes — no stuck/unhandled state.
    getSpy.mockResolvedValue(storedDoc(5, [cell(CELL_A)]))
    await vi.advanceTimersByTimeAsync(INITIAL_RETRY_MS)
    expect(patchSpy).toHaveBeenCalledTimes(1)
  })

  test('discards an in-flight push on sign-out (review C-11)', async () => {
    getSyncStateSpy.mockResolvedValue(undefined)
    let resolveCreate!: (nb: notebookApi.Notebook) => void
    createSpy.mockReturnValue(
      new Promise<notebookApi.Notebook>((r) => {
        resolveCreate = r
      }),
    )

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)
    localSaveCommittedAtom.set(1)
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS)
    expect(createSpy).toHaveBeenCalledTimes(1) // in flight

    putSyncStateSpy.mockClear()
    accessTokenAtom.set(null) // sign out mid-request
    resolveCreate(serverResponse([cell(CELL_A)])) // response arrives after logout
    await vi.advanceTimersByTimeAsync(0)

    expect(putSyncStateSpy).not.toHaveBeenCalled() // discarded — no write after logout
  })

  test('a stale teardown handle does not tear down a newer engine (review C-8)', async () => {
    const stop1 = startRemoteSync(LOCAL_NOTEBOOK_ID)
    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID) // restart (e.g. #135 re-login)
    await vi.advanceTimersByTimeAsync(0)

    stop1() // stale handle from the first start — must be a no-op

    // The current engine is still live: a committed save still pushes.
    localSaveCommittedAtom.set(1)
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS)
    expect(createSpy.mock.calls.length + patchSpy.mock.calls.length).toBe(1)
  })

  test('a hung push is aborted on pause and does not block re-login sync (review B-2)', async () => {
    getSyncStateSpy.mockResolvedValue(undefined)
    // First push hangs until its AbortSignal fires.
    createSpy.mockImplementationOnce(
      (_input: unknown, signal?: AbortSignal) =>
        new Promise<notebookApi.Notebook>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new NetworkError('aborted')))
        }),
    )

    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)
    localSaveCommittedAtom.set(1)
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS)
    expect(createSpy).toHaveBeenCalledTimes(1) // in flight, hung

    // Session expires → pause aborts the hung request (pushInFlight is released).
    pauseRemoteSync()
    await vi.advanceTimersByTimeAsync(0)

    // Re-login: a fresh start + commit pushes — not stuck behind the dead request.
    createSpy.mockResolvedValue(serverResponse([cell(CELL_A)]))
    teardown = startRemoteSync(LOCAL_NOTEBOOK_ID)
    await vi.advanceTimersByTimeAsync(0)
    localSaveCommittedAtom.set(2)
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS)
    expect(createSpy).toHaveBeenCalledTimes(2)
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
