import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { notebook as notebookApi } from '@/shared/api'
import { notebookStorage } from '../persistence/activeStorage'
import type { NotebookSyncState } from '../persistence/storageAdapter'
import {
  activeNotebookIdAtom,
  LOCAL_NOTEBOOK_ID,
  restoreNotebook,
  updateCellCode,
} from './notebook'
import { hasLocalChangesAtom } from './autosave'
import { userAtom } from '@/entities/session'
import { pullServerNotebook, stampServerNotebookOwnerIfUnowned } from './pull'

const SERVER_ID = '99999999-9999-4999-8999-999999999999'
const CELL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function serverNotebook(overrides: Partial<notebookApi.Notebook> = {}): notebookApi.Notebook {
  return {
    id: SERVER_ID,
    title: 'From server',
    ownerId: 'owner-1',
    formatVersion: 1,
    createdAt: 1,
    updatedAt: 1000,
    cells: [{ id: CELL, kind: 'code', content: 'server()', updatedAt: 1000 }],
    ...overrides,
  }
}

function cleanSyncState(notebookId: string): NotebookSyncState {
  return { notebookId, remoteCreated: true, dirty: false, deletedCells: [] }
}

let getSyncStateSpy: ReturnType<typeof vi.spyOn>
let putIfNewerSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // Default slot id is the local notebook, so a SERVER_ID pull is "not the open
  // notebook" unless a test switches the slot — isolates the durable-state path.
  activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
  getSyncStateSpy = vi.spyOn(notebookStorage, 'getSyncState').mockResolvedValue(undefined)
  // The pull write is a compare-and-swap (CL-17): re-read updatedAt, then
  // putIfNewer. Default: nothing stored locally, CAS succeeds.
  vi.spyOn(notebookStorage, 'get').mockResolvedValue(undefined)
  putIfNewerSpy = vi.spyOn(notebookStorage, 'putIfNewer').mockResolvedValue({ ok: true })
})

afterEach(() => {
  vi.restoreAllMocks()
  activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
})

describe('pullServerNotebook', () => {
  test('accepts the server version when no local copy is tracked', async () => {
    const result = await pullServerNotebook(serverNotebook())
    expect(result).toBe('accepted')
    expect(putIfNewerSpy).toHaveBeenCalledTimes(1)
    expect(putIfNewerSpy.mock.calls[0][0]).toMatchObject({ id: SERVER_ID, title: 'From server' })
  })

  test('accepts the server version when the local copy is clean', async () => {
    getSyncStateSpy.mockResolvedValue(cleanSyncState(SERVER_ID))
    const result = await pullServerNotebook(serverNotebook())
    expect(result).toBe('accepted')
    expect(putIfNewerSpy).toHaveBeenCalledTimes(1)
  })

  test('does NOT clobber a newer local write that lands during the pull (CL-17 CAS)', async () => {
    // Conflict check passes (clean sync-state), but a local-first write lands
    // before the server write: putIfNewer's CAS rejects it. The server doc must
    // not overwrite the newer local version.
    getSyncStateSpy.mockResolvedValue(cleanSyncState(SERVER_ID))
    putIfNewerSpy.mockResolvedValue({ ok: false, current: serverNotebook() })
    const result = await pullServerNotebook(serverNotebook())
    expect(result).toBe('kept-local-dirty')
  })

  test('captures the CAS baseline BEFORE the dirty check, so an intervening write is not clobbered (M1)', async () => {
    // Regression: the local baseline must be read before the dirty decision, not
    // between it and the write. A local copy exists at decision time (updatedAt
    // 100) with clean sync-state; an intervening local write then bumps it, so the
    // in-transaction CAS rejects the server overwrite (updatedAt 200).
    getSyncStateSpy.mockResolvedValue(cleanSyncState(SERVER_ID))
    const getSpy = vi.spyOn(notebookStorage, 'get').mockResolvedValue({
      formatVersion: 1,
      id: SERVER_ID,
      title: 'local',
      createdAt: 1,
      updatedAt: 100,
      cells: [{ id: CELL, kind: 'code', content: 'local()', updatedAt: 100 }],
    })
    putIfNewerSpy.mockResolvedValue({ ok: false, current: serverNotebook({ updatedAt: 150 }) })

    const result = await pullServerNotebook(serverNotebook({ updatedAt: 200 }))

    expect(result).toBe('kept-local-dirty')
    // The baseline read happens before the dirty-state read (ordering is the fix).
    expect(getSpy.mock.invocationCallOrder[0]).toBeLessThan(
      getSyncStateSpy.mock.invocationCallOrder[0],
    )
    // The CAS base is the pre-decision baseline (100), not a re-read after it.
    expect(putIfNewerSpy.mock.calls[0][1]).toBe(100)
  })

  test('keeps the local copy when its sync state is dirty', async () => {
    getSyncStateSpy.mockResolvedValue({ ...cleanSyncState(SERVER_ID), dirty: true })
    const result = await pullServerNotebook(serverNotebook())
    expect(result).toBe('kept-local-dirty')
    expect(putIfNewerSpy).not.toHaveBeenCalled()
  })

  test('keeps the local copy when it has pending tombstones', async () => {
    getSyncStateSpy.mockResolvedValue({
      ...cleanSyncState(SERVER_ID),
      deletedCells: [{ id: CELL, deletedAt: 5 }],
    })
    const result = await pullServerNotebook(serverNotebook())
    expect(result).toBe('kept-local-dirty')
    expect(putIfNewerSpy).not.toHaveBeenCalled()
  })

  test('keeps the local copy on an unresolved owner conflict', async () => {
    getSyncStateSpy.mockResolvedValue({ ...cleanSyncState(SERVER_ID), ownerConflict: true })
    const result = await pullServerNotebook(serverNotebook())
    expect(result).toBe('kept-local-dirty')
    expect(putIfNewerSpy).not.toHaveBeenCalled()
  })

  test('keeps the open notebook when the editor has unsaved in-memory changes', async () => {
    // The pulled notebook IS the one in the slot, and the editor is dirty even
    // though the durable sync state has not recorded it yet.
    restoreNotebook({
      formatVersion: 1,
      id: SERVER_ID,
      title: 'Open',
      createdAt: 1,
      updatedAt: 1,
      cells: [{ id: CELL, kind: 'code', content: 'open()', updatedAt: 1 }],
    })
    updateCellCode(CELL, 'edited-in-editor()')
    expect(hasLocalChangesAtom()).toBe(true)

    const result = await pullServerNotebook(serverNotebook())
    expect(result).toBe('kept-local-dirty')
    expect(putIfNewerSpy).not.toHaveBeenCalled()
  })

  test('rejects a malformed server payload without writing storage (§11)', async () => {
    // A 2xx whose formatVersion is not the current one fails the boundary guard.
    const result = await pullServerNotebook(serverNotebook({ formatVersion: 99 }))
    expect(result).toBe('rejected')
    expect(putIfNewerSpy).not.toHaveBeenCalled()
  })
})

// TARDIS-183 blocker: a server notebook merely opened (never edited) had no
// sync-state ownerId, so `listOwnedLocalNotebooks` rejected it and the startup
// resolver fell back to another notebook. `openNotebookInSlot` now stamps it via
// this helper, mirroring `bootReconcile`.
describe('stampServerNotebookOwnerIfUnowned', () => {
  let putSyncStateSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    putSyncStateSpy = vi.spyOn(notebookStorage, 'putSyncState').mockResolvedValue(undefined)
    userAtom.set({ id: 'owner-A', email: 'a@b.c', displayName: null, roles: [] })
  })
  afterEach(() => {
    userAtom.set(null)
  })

  test('stamps the current user as owner when no sync-state exists', async () => {
    getSyncStateSpy.mockResolvedValue(undefined)

    await stampServerNotebookOwnerIfUnowned(serverNotebook())

    expect(putSyncStateSpy).toHaveBeenCalledTimes(1)
    expect(putSyncStateSpy.mock.calls[0][0]).toMatchObject({
      notebookId: SERVER_ID,
      ownerId: 'owner-A',
      remoteCreated: true,
      dirty: false,
    })
  })

  test('does NOT overwrite an existing sync-state (no cross-account clobber, §11)', async () => {
    getSyncStateSpy.mockResolvedValue(cleanSyncState(SERVER_ID))

    await stampServerNotebookOwnerIfUnowned(serverNotebook())

    expect(putSyncStateSpy).not.toHaveBeenCalled()
  })

  test('is a no-op when signed out (no owner to stamp)', async () => {
    userAtom.set(null)
    getSyncStateSpy.mockResolvedValue(undefined)

    await stampServerNotebookOwnerIfUnowned(serverNotebook())

    expect(putSyncStateSpy).not.toHaveBeenCalled()
  })
})
