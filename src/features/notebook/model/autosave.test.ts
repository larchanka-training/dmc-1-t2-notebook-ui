import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { notebookStorage } from '../persistence/activeStorage'
import { NewerFormatError } from '../persistence/migrations'
import type { NotebookJSON } from '../persistence/schema'
import {
  addCell,
  cellsAtom,
  LOCAL_NOTEBOOK_ID,
  notebookBaseUpdatedAtAtom,
  setNotebookTitle,
  storageCompatibilityAtom,
  updateCellCode,
} from './notebook'
import {
  hasLocalChangesAtom,
  lastSavedAtAtom,
  localSaveCommittedAtom,
  markBootRestored,
  reloadFromStorage,
  saveMine,
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
    localSaveCommittedAtom.set(0)
    storageCompatibilityAtom.set('ok')
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

  test('recovers to saved on the next write after an error', async () => {
    const putIfNewer = vi
      .spyOn(notebookStorage, 'putIfNewer')
      .mockRejectedValueOnce(new Error('QuotaExceededError'))
      .mockResolvedValue({ ok: true })
    const stop = startAutosave()
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'boom')
    await vi.advanceTimersByTimeAsync(500)
    expect(saveStatusAtom()).toBe('error')
    // A later edit re-arms the debounce; the now-succeeding write clears the error.
    updateCellCode(cell.id, 'recovered')
    await vi.advanceTimersByTimeAsync(500)
    expect(putIfNewer).toHaveBeenCalledTimes(2)
    expect(saveStatusAtom()).toBe('saved')
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

  test('does not write when storage contains a notebook from a newer app version', async () => {
    storageCompatibilityAtom.set('newer-format')
    const putIfNewer = vi.spyOn(notebookStorage, 'putIfNewer').mockResolvedValue({ ok: true })
    await saveNow()
    expect(putIfNewer).not.toHaveBeenCalled()
    expect(saveStatusAtom()).toBe('outdated')
  })

  test('startAutosave surfaces outdated immediately and does not arm writes', async () => {
    storageCompatibilityAtom.set('newer-format')
    const putIfNewer = vi.spyOn(notebookStorage, 'putIfNewer').mockResolvedValue({ ok: true })
    const stop = startAutosave()
    expect(saveStatusAtom()).toBe('outdated')
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'local change on an outdated client')
    await vi.advanceTimersByTimeAsync(500)
    expect(putIfNewer).not.toHaveBeenCalled()
    expect(saveStatusAtom()).toBe('outdated')
    stop()
  })

  test('reloadFromStorage goes outdated (not unhandled) when the stored notebook is too new', async () => {
    // The "Reload" button and the cross-tab pull both call this; get() runs
    // applyMigrations, so a newer-format record reaches here as a rejection.
    vi.spyOn(notebookStorage, 'get').mockRejectedValue(new NewerFormatError(99, 1))
    await expect(reloadFromStorage()).resolves.toBe(false)
    expect(storageCompatibilityAtom()).toBe('newer-format')
    expect(saveStatusAtom()).toBe('outdated')
  })

  test('reloadFromStorage surfaces a generic storage failure as error', async () => {
    vi.spyOn(notebookStorage, 'get').mockRejectedValue(new Error('blocked DB'))
    await expect(reloadFromStorage()).resolves.toBe(false)
    expect(saveStatusAtom()).toBe('error')
  })

  test('changing the title via setNotebookTitle triggers an autosave', async () => {
    const putIfNewer = vi.spyOn(notebookStorage, 'putIfNewer').mockResolvedValue({ ok: true })
    const stop = startAutosave()
    setNotebookTitle('A brand new title')
    await vi.advanceTimersByTimeAsync(500)
    expect(putIfNewer).toHaveBeenCalledTimes(1)
    expect(saveStatusAtom()).toBe('saved')
    stop()
  })

  test('setNotebookTitle with the same title does not arm a save', async () => {
    const putIfNewer = vi.spyOn(notebookStorage, 'putIfNewer').mockResolvedValue({ ok: true })
    const stop = startAutosave()
    setNotebookTitle('Untitled notebook') // identical to the seed title
    await vi.advanceTimersByTimeAsync(500)
    expect(putIfNewer).not.toHaveBeenCalled()
    stop()
  })

  describe('markBootRestored', () => {
    test('surfaces "saved" from the stored timestamp after a real restore', () => {
      notebookBaseUpdatedAtAtom.set(1_700_000_500_000)
      markBootRestored()
      expect(saveStatusAtom()).toBe('saved')
      expect(lastSavedAtAtom()).toBe(1_700_000_500_000)
    })

    test('stays idle when there is no stored baseline (fresh seed / failed boot)', () => {
      notebookBaseUpdatedAtAtom.set(null)
      markBootRestored()
      expect(saveStatusAtom()).toBe('idle')
      expect(lastSavedAtAtom()).toBeNull()
    })

    test('does not override the newer-format gate', () => {
      notebookBaseUpdatedAtAtom.set(1_700_000_500_000)
      storageCompatibilityAtom.set('newer-format')
      markBootRestored()
      expect(saveStatusAtom()).toBe('idle')
      expect(lastSavedAtAtom()).toBeNull()
    })
  })

  // saveMine and the focus/visibility re-check now reach storage through the
  // facade (`notebookStorage`); these pin those paths so a future facade change
  // can't silently break force-write or the background staleness check.
  describe('saveMine (force-write through the facade)', () => {
    test('writes this tab version and marks saved', async () => {
      vi.spyOn(notebookStorage, 'get').mockResolvedValue(undefined)
      const put = vi.spyOn(notebookStorage, 'put').mockResolvedValue()
      await saveMine()
      expect(put).toHaveBeenCalledTimes(1)
      expect(saveStatusAtom()).toBe('saved')
      expect(lastSavedAtAtom()).not.toBeNull()
    })

    test('marks outdated when the store reports a newer format', async () => {
      vi.spyOn(notebookStorage, 'get').mockRejectedValue(new NewerFormatError(99, 1))
      await saveMine()
      expect(storageCompatibilityAtom()).toBe('newer-format')
      expect(saveStatusAtom()).toBe('outdated')
    })

    test('marks error on a generic storage failure', async () => {
      vi.spyOn(notebookStorage, 'get').mockResolvedValue(undefined)
      vi.spyOn(notebookStorage, 'put').mockRejectedValue(new Error('QuotaExceededError'))
      await saveMine()
      expect(saveStatusAtom()).toBe('error')
    })
  })

  test('re-checks the store through the facade on window focus', async () => {
    const get = vi.spyOn(notebookStorage, 'get').mockResolvedValue(undefined)
    const stop = startAutosave()
    get.mockClear()
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(get).toHaveBeenCalledWith(LOCAL_NOTEBOOK_ID)
    // A clean background check leaves the indicator untouched (advisory only).
    expect(saveStatusAtom()).toBe('idle')
    stop()
  })

  test('re-checks the store through the facade on visibilitychange when visible', async () => {
    // jsdom defaults document.visibilityState to 'visible', so the handler runs.
    const get = vi.spyOn(notebookStorage, 'get').mockResolvedValue(undefined)
    const stop = startAutosave()
    get.mockClear()
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(get).toHaveBeenCalledWith(LOCAL_NOTEBOOK_ID)
    stop()
  })

  test('gates to newer-format/outdated when the background focus check reads a newer record', async () => {
    vi.spyOn(notebookStorage, 'get').mockRejectedValue(new NewerFormatError(99, 1))
    const stop = startAutosave()
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(storageCompatibilityAtom()).toBe('newer-format')
    expect(saveStatusAtom()).toBe('outdated')
    stop()
  })

  test('persists a real snapshot through the facade — read-back, no storage spy', async () => {
    // Integration-style: no putIfNewer spy. Real timers because fake-indexeddb
    // schedules transaction callbacks on real macrotasks; drive saveNow()
    // directly to skip the 500ms debounce.
    vi.useRealTimers()
    await notebookStorage.clearAll()
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'persisted-through-facade')
    await saveNow()
    expect(saveStatusAtom()).toBe('saved')
    const stored = await notebookStorage.get(LOCAL_NOTEBOOK_ID)
    expect(stored?.cells.map((c) => c.content)).toContain('persisted-through-facade')
  })

  // The signal the #134 remote-sync layer subscribes to: it must fire on a
  // committed local edit (so a push follows) but NOT on a pull/boot restore (so a
  // just-restored version is not bounced back to the server).
  describe('localSaveCommittedAtom (remote-sync trigger)', () => {
    test('bumps after a committed debounced save', async () => {
      vi.spyOn(notebookStorage, 'putIfNewer').mockResolvedValue({ ok: true })
      const before = localSaveCommittedAtom()
      const stop = startAutosave()
      const [cell] = cellsAtom()
      updateCellCode(cell.id, 'edit that commits locally')
      await vi.advanceTimersByTimeAsync(500)
      expect(localSaveCommittedAtom()).toBe(before + 1)
      stop()
    })

    test('bumps after saveMine', async () => {
      vi.spyOn(notebookStorage, 'get').mockResolvedValue(undefined)
      vi.spyOn(notebookStorage, 'put').mockResolvedValue()
      const before = localSaveCommittedAtom()
      await saveMine()
      expect(localSaveCommittedAtom()).toBe(before + 1)
    })

    test('does NOT bump on reloadFromStorage (a pull, not a local edit)', async () => {
      vi.spyOn(notebookStorage, 'get').mockResolvedValue(storedNotebook(20, 'from another tab'))
      const before = localSaveCommittedAtom()
      await reloadFromStorage()
      expect(localSaveCommittedAtom()).toBe(before)
    })

    test('does NOT bump on markBootRestored', () => {
      notebookBaseUpdatedAtAtom.set(1_700_000_500_000)
      const before = localSaveCommittedAtom()
      markBootRestored()
      expect(localSaveCommittedAtom()).toBe(before)
    })
  })
})
