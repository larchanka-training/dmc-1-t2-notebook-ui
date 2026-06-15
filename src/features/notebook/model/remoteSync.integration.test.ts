import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { notebook as notebookApi } from '@/shared/api'
import { accessTokenAtom, userAtom } from '@/entities/session'
import { notebookStorage } from '../persistence/activeStorage'
import { cellsAtom, DEMO_NOTEBOOK_ID, loadNotebook, updateCellCode } from './notebook'
import { startAutosave } from './autosave'
import { isOnlineAtom } from './online'
import { startRemoteSync } from './remoteSync'

// Composed seam test (review veai C-2): real autosave + real active storage
// (fake-indexeddb) + real remote-sync engine, a real notebook mutation, and a spied
// API. Proves edit → local persist → remote debounce → push of the SAME persisted
// document — the central local-first contract the unit tests mock around. Real
// timers (fake-indexeddb schedules on macrotasks; autosave 500ms + remote 1500ms).

/** Poll until `predicate` holds (or time out) — avoids a fixed wall-clock sleep. */
async function waitFor(predicate: () => boolean, timeoutMs = 5000, stepMs = 25): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out')
    await new Promise((resolve) => setTimeout(resolve, stepMs))
  }
}

describe('autosave → storage → remote-sync integration', () => {
  let stopAutosave: (() => void) | undefined
  let stopSync: (() => void) | undefined

  beforeEach(async () => {
    await notebookStorage.clearAll()
    accessTokenAtom.set('token')
    // A concrete signed-in user — the owner-gate requires an attributable owner.
    userAtom.set({ id: '33333333-3333-4333-8333-333333333333', roles: [] })
    isOnlineAtom.set(true)
  })

  afterEach(() => {
    stopSync?.()
    stopAutosave?.()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  test('a real edit autosaves locally then pushes the persisted snapshot', async () => {
    const createSpy = vi.spyOn(notebookApi, 'create').mockImplementation(async (input) => ({
      id: DEMO_NOTEBOOK_ID,
      title: input.title,
      ownerId: 'owner-1',
      formatVersion: input.formatVersion,
      createdAt: 1,
      updatedAt: 2,
      cells: input.cells ?? [],
    }))

    await loadNotebook() // seed + boot the local notebook
    stopAutosave = startAutosave()
    stopSync = startRemoteSync(DEMO_NOTEBOOK_ID)

    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'integration-edit')

    // The autosave (500ms) then the remote debounce (1500ms) drive the push; poll
    // for it instead of a fixed sleep.
    await waitFor(() => createSpy.mock.calls.length > 0)

    expect(createSpy).toHaveBeenCalledTimes(1)
    const body = createSpy.mock.calls[0][0]
    expect(body.cells?.some((c) => c.content === 'integration-edit')).toBe(true)
    // The pushed cells are exactly what is persisted locally (local-first).
    const stored = await notebookStorage.get(DEMO_NOTEBOOK_ID)
    expect(body.cells?.map((c) => c.content)).toEqual(stored?.cells.map((c) => c.content))
  })
})
