// Debounced autosave of the local notebook to IndexedDB.
//
// Wiring: `startAutosave()` subscribes to a content signal; every change
// schedules a save 500 ms later, collapsing a burst of keystrokes into one
// write. The save status drives the header indicator.
//
// Two Reatom-under-clearStack subtleties (see runtime.ts `flush` and
// theme.ts `startThemeSync` for the established patterns):
//   - the debounced callback fires from a timer (a fresh async boundary), so
//     it must be `wrap`-captured to touch atoms in production where
//     `clearStack()` is active;
//   - `dirtyAtom` is a `computed`; it only recomputes while it has a live
//     subscriber, which `startAutosave` provides for the app's lifetime.

import { atom, computed, wrap } from '@reatom/core'
import * as notebookStorage from '../persistence/storage'
import { cellsAtom, notebookSnapshot, notebookTitleAtom } from './notebook'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const DEBOUNCE_MS = 500

/** Current autosave state, surfaced by the header indicator. */
export const saveStatusAtom = atom<SaveStatus>('idle', 'notebook.autosave.status')

/** Unix ms of the last successful save, or null if nothing has been saved yet. */
export const lastSavedAtAtom = atom<number | null>(null, 'notebook.autosave.lastSavedAt')

/**
 * A string that changes whenever persisted content changes. Editing a cell
 * mutates an inner atom (not the `cellsAtom` array reference), so we cannot
 * dirty-check by reference — we hash the serialized cells + title instead.
 * Cheap relative to a 500 ms debounce.
 */
const dirtyAtom = computed(() => {
  return JSON.stringify(
    cellsAtom().map((cell) => ({
      id: cell.id,
      kind: cell.kind,
      content: cell.code(),
      updatedAt: cell.updatedAt(),
    })),
  ).concat('\u0000', notebookTitleAtom())
}, 'notebook.autosave.dirty')

/**
 * Persist the current notebook now, updating the status atoms. Exposed so the
 * "Save failed — retry" affordance can force a write without waiting for the
 * next edit.
 */
export async function saveNow(): Promise<void> {
  saveStatusAtom.set('saving')
  try {
    await wrap(notebookStorage.put(notebookSnapshot()))
    lastSavedAtAtom.set(Date.now())
    saveStatusAtom.set('saved')
  } catch {
    // Quota exceeded, blocked DB, private-mode restrictions — surface the
    // failure in the indicator but never let it crash the editor.
    saveStatusAtom.set('error')
  }
}

/**
 * Start autosaving for the app's lifetime. Subscribes to the content signal;
 * each change (re)arms a 500 ms timer, so only the last edit in a burst is
 * written. The first synchronous call on subscribe is skipped — loading a
 * notebook should not immediately re-save it. Returns an unsubscribe handle.
 */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let primed = false

  const runSave = wrap(() => {
    timer = null
    void saveNow()
  })

  const unsubscribe = dirtyAtom.subscribe(() => {
    // Skip the initial synchronous emit: nothing has changed yet.
    if (!primed) {
      primed = true
      return
    }
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(runSave, DEBOUNCE_MS)
  })

  return () => {
    if (timer !== null) clearTimeout(timer)
    unsubscribe()
  }
}
