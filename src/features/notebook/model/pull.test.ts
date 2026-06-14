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
import { pullServerNotebook } from './pull'

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
let putSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // Default slot id is the local notebook, so a SERVER_ID pull is "not the open
  // notebook" unless a test switches the slot — isolates the durable-state path.
  activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
  getSyncStateSpy = vi.spyOn(notebookStorage, 'getSyncState').mockResolvedValue(undefined)
  putSpy = vi.spyOn(notebookStorage, 'put').mockResolvedValue()
})

afterEach(() => {
  vi.restoreAllMocks()
  activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
})

describe('pullServerNotebook', () => {
  test('accepts the server version when no local copy is tracked', async () => {
    const result = await pullServerNotebook(serverNotebook())
    expect(result).toBe('accepted')
    expect(putSpy).toHaveBeenCalledTimes(1)
    expect(putSpy.mock.calls[0][0]).toMatchObject({ id: SERVER_ID, title: 'From server' })
  })

  test('accepts the server version when the local copy is clean', async () => {
    getSyncStateSpy.mockResolvedValue(cleanSyncState(SERVER_ID))
    const result = await pullServerNotebook(serverNotebook())
    expect(result).toBe('accepted')
    expect(putSpy).toHaveBeenCalledTimes(1)
  })

  test('keeps the local copy when its sync state is dirty', async () => {
    getSyncStateSpy.mockResolvedValue({ ...cleanSyncState(SERVER_ID), dirty: true })
    const result = await pullServerNotebook(serverNotebook())
    expect(result).toBe('kept-local-dirty')
    expect(putSpy).not.toHaveBeenCalled()
  })

  test('keeps the local copy when it has pending tombstones', async () => {
    getSyncStateSpy.mockResolvedValue({
      ...cleanSyncState(SERVER_ID),
      deletedCells: [{ id: CELL, deletedAt: 5 }],
    })
    const result = await pullServerNotebook(serverNotebook())
    expect(result).toBe('kept-local-dirty')
    expect(putSpy).not.toHaveBeenCalled()
  })

  test('keeps the local copy on an unresolved owner conflict', async () => {
    getSyncStateSpy.mockResolvedValue({ ...cleanSyncState(SERVER_ID), ownerConflict: true })
    const result = await pullServerNotebook(serverNotebook())
    expect(result).toBe('kept-local-dirty')
    expect(putSpy).not.toHaveBeenCalled()
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
    expect(putSpy).not.toHaveBeenCalled()
  })

  test('rejects a malformed server payload without writing storage (§11)', async () => {
    // A 2xx whose formatVersion is not the current one fails the boundary guard.
    const result = await pullServerNotebook(serverNotebook({ formatVersion: 99 }))
    expect(result).toBe('rejected')
    expect(putSpy).not.toHaveBeenCalled()
  })
})
