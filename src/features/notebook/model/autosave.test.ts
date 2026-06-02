import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as notebookStorage from '../persistence/storage'
import { addCell, cellsAtom, updateCellCode } from './notebook'
import { lastSavedAtAtom, saveStatusAtom, startAutosave } from './autosave'

// Reatom notifies atom subscribers on a microtask after a `.set` (see the note
// in theme.test.ts). `advanceTimersByTimeAsync` flushes the microtask queue
// between timer ticks, so it covers both the subscription notification (which
// arms the debounce timer) and the `save()` promise (which calls `put`).

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
    const put = vi.spyOn(notebookStorage, 'put').mockResolvedValue()
    const stop = startAutosave()
    await vi.advanceTimersByTimeAsync(1000)
    expect(put).not.toHaveBeenCalled()
    stop()
  })

  test('saves once, 500ms after an edit', async () => {
    const put = vi.spyOn(notebookStorage, 'put').mockResolvedValue()
    const stop = startAutosave()
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'changed')
    await vi.advanceTimersByTimeAsync(499)
    expect(put).not.toHaveBeenCalled() // still within debounce window
    await vi.advanceTimersByTimeAsync(1)
    expect(put).toHaveBeenCalledTimes(1)
    expect(saveStatusAtom()).toBe('saved')
    expect(lastSavedAtAtom()).not.toBeNull()
    stop()
  })

  test('coalesces a burst of edits into a single write', async () => {
    const put = vi.spyOn(notebookStorage, 'put').mockResolvedValue()
    const stop = startAutosave()
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'a')
    await vi.advanceTimersByTimeAsync(200)
    updateCellCode(cell.id, 'ab')
    await vi.advanceTimersByTimeAsync(200)
    updateCellCode(cell.id, 'abc')
    await vi.advanceTimersByTimeAsync(500)
    expect(put).toHaveBeenCalledTimes(1)
    stop()
  })

  test('a new edit after a save triggers a second write', async () => {
    const put = vi.spyOn(notebookStorage, 'put').mockResolvedValue()
    const stop = startAutosave()
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'first')
    await vi.advanceTimersByTimeAsync(500)
    addCell()
    await vi.advanceTimersByTimeAsync(500)
    expect(put).toHaveBeenCalledTimes(2)
    stop()
  })

  test('sets status to error when the write fails (and does not throw)', async () => {
    vi.spyOn(notebookStorage, 'put').mockRejectedValue(new Error('QuotaExceededError'))
    const stop = startAutosave()
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'boom')
    await vi.advanceTimersByTimeAsync(500)
    expect(saveStatusAtom()).toBe('error')
    stop()
  })

  test('stop() cancels a pending save', async () => {
    const put = vi.spyOn(notebookStorage, 'put').mockResolvedValue()
    const stop = startAutosave()
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'pending')
    await vi.advanceTimersByTimeAsync(200)
    stop()
    await vi.advanceTimersByTimeAsync(500)
    expect(put).not.toHaveBeenCalled()
  })
})
