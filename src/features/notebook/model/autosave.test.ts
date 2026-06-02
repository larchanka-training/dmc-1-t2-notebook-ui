import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as notebookStorage from '../persistence/storage'
import type { NotebookJSON } from '../persistence/schema'
import {
  addCell,
  cellsAtom,
  LOCAL_NOTEBOOK_ID,
  notebookBaseUpdatedAtAtom,
  updateCellCode,
} from './notebook'
import {
  hasLocalChangesAtom,
  lastSavedAtAtom,
  reloadFromStorage,
  saveNow,
  saveStatusAtom,
  startAutosave,
} from './autosave'

function storedNotebook(updatedAt: number, content: string): NotebookJSON {
  return {
    formatVersion: 1,
    id: LOCAL_NOTEBOOK_ID,
    title: 'Stored',
    createdAt: 1,
    updatedAt,
    cells: [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        kind: 'code',
        content,
        updatedAt,
      },
    ],
  }
}

// Reatom notifies atom subscribers on a microtask after a `.set` (see the note
// in theme.test.ts). `advanceTimersByTimeAsync` flushes the microtask queue
// between timer ticks, so it covers both the subscription notification (which
// arms the debounce timer) and the `save()` promise (which calls `putIfNewer`).

describe('notebook autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    saveStatusAtom.set('idle')
    lastSavedAtAtom.set(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  test('does not save on the initial subscribe (no spurious write)', async () => {
    const putIfNewer = vi.spyOn(notebookStorage, 'putIfNewer').mockResolvedValue({ ok: true })
    const stop = startAutosave()
    await vi.advanceTimersByTimeAsync(1000)
    expect(putIfNewer).not.toHaveBeenCalled()
    stop()
  })

  test('saves once, 500ms after an edit', async () => {
    const putIfNewer = vi.spyOn(notebookStorage, 'putIfNewer').mockResolvedValue({ ok: true })
    const stop = startAutosave()
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'changed')
    await vi.advanceTimersByTimeAsync(499)
    expect(putIfNewer).not.toHaveBeenCalled() // still within debounce window
    await vi.advanceTimersByTimeAsync(1)
    expect(putIfNewer).toHaveBeenCalledTimes(1)
    expect(saveStatusAtom()).toBe('saved')
    expect(lastSavedAtAtom()).not.toBeNull()
    stop()
  })

  test('coalesces a burst of edits into a single write', async () => {
    const putIfNewer = vi.spyOn(notebookStorage, 'putIfNewer').mockResolvedValue({ ok: true })
    const stop = startAutosave()
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'a')
    await vi.advanceTimersByTimeAsync(200)
    updateCellCode(cell.id, 'ab')
    await vi.advanceTimersByTimeAsync(200)
    updateCellCode(cell.id, 'abc')
    await vi.advanceTimersByTimeAsync(500)
    expect(putIfNewer).toHaveBeenCalledTimes(1)
    stop()
  })

  test('a new edit after a save triggers a second write', async () => {
    const putIfNewer = vi.spyOn(notebookStorage, 'putIfNewer').mockResolvedValue({ ok: true })
    const stop = startAutosave()
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'first')
    await vi.advanceTimersByTimeAsync(500)
    addCell()
    await vi.advanceTimersByTimeAsync(500)
    expect(putIfNewer).toHaveBeenCalledTimes(2)
    stop()
  })

  test('sets status to error when the write fails (and does not throw)', async () => {
    vi.spyOn(notebookStorage, 'putIfNewer').mockRejectedValue(new Error('QuotaExceededError'))
    const stop = startAutosave()
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'boom')
    await vi.advanceTimersByTimeAsync(500)
    expect(saveStatusAtom()).toBe('error')
    stop()
  })

  test('stop() cancels a pending save', async () => {
    const putIfNewer = vi.spyOn(notebookStorage, 'putIfNewer').mockResolvedValue({ ok: true })
    const stop = startAutosave()
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'pending')
    await vi.advanceTimersByTimeAsync(200)
    stop()
    await vi.advanceTimersByTimeAsync(500)
    expect(putIfNewer).not.toHaveBeenCalled()
  })

  test('serializes overlapping saves from the same tab instead of self-conflicting', async () => {
    let releaseFirst!: () => void
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const putIfNewer = vi.spyOn(notebookStorage, 'putIfNewer').mockImplementation(async () => {
      if (putIfNewer.mock.calls.length === 1) await firstWrite
      return { ok: true }
    })

    notebookBaseUpdatedAtAtom.set(10)
    const [cell] = cellsAtom()
    const firstSave = saveNow()
    updateCellCode(cell.id, 'edit while first save is in flight')
    const secondSave = saveNow()

    expect(putIfNewer).toHaveBeenCalledTimes(1)
    releaseFirst()
    await firstSave
    await secondSave

    expect(putIfNewer).toHaveBeenCalledTimes(2)
    expect(saveStatusAtom()).toBe('saved')
  })

  test('sets conflict instead of overwriting a newer stored notebook', async () => {
    vi.spyOn(notebookStorage, 'putIfNewer').mockResolvedValue({
      ok: false,
      current: storedNotebook(20, 'other tab'),
    })
    notebookBaseUpdatedAtAtom.set(10)
    const stop = startAutosave()
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'stale local edit')
    await vi.advanceTimersByTimeAsync(500)
    expect(saveStatusAtom()).toBe('conflict')
    stop()
  })

  test('reloadFromStorage accepts a newer stored notebook as the clean baseline', async () => {
    const stored = storedNotebook(20, 'from another tab')
    vi.spyOn(notebookStorage, 'get').mockResolvedValue(stored)
    await reloadFromStorage()
    expect(cellsAtom()[0].code()).toBe('from another tab')
    expect(notebookBaseUpdatedAtAtom()).toBe(20)
    expect(hasLocalChangesAtom()).toBe(false)
    expect(saveStatusAtom()).toBe('saved')
  })
})
