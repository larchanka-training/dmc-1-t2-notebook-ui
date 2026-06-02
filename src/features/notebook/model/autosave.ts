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
import { openCrossTabChannel } from '../persistence/crosstab'
import type { NotebookJSON } from '../persistence/schema'
import {
  cellsAtom,
  LOCAL_NOTEBOOK_ID,
  notebookBaseUpdatedAtAtom,
  notebookSnapshot,
  notebookTitleAtom,
  restoreNotebook,
} from './notebook'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'

const DEBOUNCE_MS = 500
const VISIBILITY_VISIBLE = 'visible'

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
type HashCell = NotebookJSON['cells'][number]

function persistedHash(cells: HashCell[], title: string): string {
  return JSON.stringify(cells).concat('\u0000', title)
}

const dirtyAtom = computed(() => {
  return persistedHash(
    cellsAtom().map((cell) => ({
      id: cell.id,
      kind: cell.kind,
      content: cell.code(),
      updatedAt: cell.updatedAt(),
    })),
    notebookTitleAtom(),
  )
}, 'notebook.autosave.dirty')

// The persisted-content hash of the last version this tab has accepted as its
// baseline (boot restore, successful save, or seamless cross-tab pull). If the
// current dirty hash differs, this tab has local changes and must not
// auto-restore a version saved by another tab.
const savedHashAtom = atom<string | null>(null, 'notebook.autosave.savedHash')

/** True when this tab has local changes relative to its accepted baseline. */
export const hasLocalChangesAtom = computed(
  () => savedHashAtom() !== dirtyAtom(),
  'notebook.autosave.hasLocalChanges',
)

/** Mark the current in-memory notebook as the accepted clean baseline. */
function acceptCurrentBaseline(updatedAt: number): void {
  notebookBaseUpdatedAtAtom.set(updatedAt)
  savedHashAtom.set(dirtyAtom())
}

/** Mark a concrete persisted document as the accepted clean baseline. */
function acceptStoredBaseline(notebook: NotebookJSON): void {
  notebookBaseUpdatedAtAtom.set(notebook.updatedAt)
  savedHashAtom.set(persistedHash(notebook.cells, notebook.title))
}

function snapshotAfter(minUpdatedAt: number): ReturnType<typeof notebookSnapshot> {
  const snapshot = notebookSnapshot()
  if (snapshot.updatedAt > minUpdatedAt) return snapshot
  return { ...snapshot, updatedAt: minUpdatedAt + 1 }
}

let saveInFlight = false
let saveAgainAfterCurrent = false

async function runConditionalSave(): Promise<void> {
  const base = notebookBaseUpdatedAtAtom()
  const snapshot = snapshotAfter(base ?? 0)
  const result = await wrap(notebookStorage.putIfNewer(snapshot, base))
  if (!result.ok) {
    saveStatusAtom.set('conflict')
    return
  }
  acceptStoredBaseline(snapshot)
  lastSavedAtAtom.set(Date.now())
  saveStatusAtom.set('saved')
  channel?.postSaved(snapshot.id, snapshot.updatedAt)
}

/**
 * Persist the current notebook now, updating the status atoms. Exposed so the
 * "Save failed — retry" affordance can force a write without waiting for the
 * next edit.
 */
export async function saveNow(): Promise<void> {
  if (saveInFlight) {
    saveAgainAfterCurrent = true
    return
  }

  saveInFlight = true
  saveStatusAtom.set('saving')
  try {
    do {
      saveAgainAfterCurrent = false
      await runConditionalSave()
    } while (saveAgainAfterCurrent && hasLocalChangesAtom() && saveStatusAtom() !== 'conflict')
  } catch {
    // Quota exceeded, blocked DB, private-mode restrictions — surface the
    // failure in the indicator but never let it crash the editor.
    saveStatusAtom.set('error')
  } finally {
    saveInFlight = false
  }
}

/** Reload the latest stored notebook, discarding this tab's local version. */
export async function reloadFromStorage(): Promise<void> {
  const stored = await wrap(notebookStorage.get(LOCAL_NOTEBOOK_ID))
  if (!stored) return
  restoreNotebook(stored)
  acceptStoredBaseline(stored)
  lastSavedAtAtom.set(Date.now())
  saveStatusAtom.set('saved')
}

/** Force-write this tab's current version, replacing whatever another tab saved. */
export async function saveMine(): Promise<void> {
  saveStatusAtom.set('saving')
  try {
    const stored = await wrap(notebookStorage.get(LOCAL_NOTEBOOK_ID))
    const snapshot = snapshotAfter(
      Math.max(notebookBaseUpdatedAtAtom() ?? 0, stored?.updatedAt ?? 0),
    )
    await wrap(notebookStorage.put(snapshot))
    acceptStoredBaseline(snapshot)
    lastSavedAtAtom.set(Date.now())
    saveStatusAtom.set('saved')
    channel?.postSaved(snapshot.id, snapshot.updatedAt)
  } catch {
    saveStatusAtom.set('error')
  }
}

/**
 * Start autosaving for the app's lifetime. Subscribes to the content signal;
 * each change (re)arms a 500 ms timer, so only the last edit in a burst is
 * written. The first synchronous call on subscribe is skipped — loading a
 * notebook should not immediately re-save it. Returns an unsubscribe handle.
 */
let channel: ReturnType<typeof openCrossTabChannel> | null = null

async function handleExternalSave(updatedAt: number): Promise<void> {
  const base = notebookBaseUpdatedAtAtom()
  if (base !== null && updatedAt <= base) return

  if (hasLocalChangesAtom()) {
    saveStatusAtom.set('conflict')
    return
  }

  await reloadFromStorage()
}

async function checkStoredVersion(): Promise<void> {
  try {
    const stored = await wrap(notebookStorage.get(LOCAL_NOTEBOOK_ID))
    if (!stored) return
    await handleExternalSave(stored.updatedAt)
  } catch {
    // A focus/visibility sync failure is advisory; the normal autosave path
    // will surface storage errors if the user edits. Do not annoy the user with
    // a transient conflict/error just because a background check failed.
  }
}

function subscribeToFocusChecks(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}

  const onFocus = wrap(() => {
    void checkStoredVersion()
  })
  const onVisibility = wrap(() => {
    if (document.visibilityState === VISIBILITY_VISIBLE) void checkStoredVersion()
  })

  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}

export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let primed = false

  acceptCurrentBaseline(notebookBaseUpdatedAtAtom() ?? 0)

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
    if (!hasLocalChangesAtom()) return
    timer = setTimeout(runSave, DEBOUNCE_MS)
  })

  channel = openCrossTabChannel(
    wrap((message) => {
      if (message.id !== LOCAL_NOTEBOOK_ID) return
      void handleExternalSave(message.updatedAt)
    }),
  )
  const unsubscribeFocusChecks = subscribeToFocusChecks()

  return () => {
    if (timer !== null) clearTimeout(timer)
    unsubscribe()
    unsubscribeFocusChecks()
    channel?.close()
    channel = null
  }
}
