// Debounced autosave of the local notebook to the active storage backend.
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
//   - the watched signal must stay "hot" for the app lifetime. We use a cheap
//     monotonic revision atom instead of re-serializing the whole notebook on
//     every keypress.

import { atom, computed, wrap } from '@reatom/core'
import { notebookStorage } from '../persistence/activeStorage'
import { NewerFormatError } from '../persistence/migrations'
import { openCrossTabChannel } from '../persistence/crosstab'
import {
  LOCAL_NOTEBOOK_ID,
  notebookBaseUpdatedAtAtom,
  notebookSnapshot,
  restoreNotebook,
  storageCompatibilityAtom,
} from './notebook'
import { notebookRevisionAtom } from './revision'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict' | 'outdated'

const DEBOUNCE_MS = 500
const VISIBILITY_VISIBLE = 'visible'

/** Current autosave state, surfaced by the header indicator. */
export const saveStatusAtom = atom<SaveStatus>('idle', 'notebook.autosave.status')

/** Unix ms of the last successful save, or null if nothing has been saved yet. */
export const lastSavedAtAtom = atom<number | null>(null, 'notebook.autosave.lastSavedAt')

// The local revision number that corresponds to the last persisted/accepted
// baseline. If the current revision differs, this tab has unsaved local changes.
const savedRevisionAtom = atom<number>(0, 'notebook.autosave.savedRevision')

/** True when this tab has local changes relative to its accepted baseline. */
export const hasLocalChangesAtom = computed(
  () => notebookRevisionAtom() !== savedRevisionAtom(),
  'notebook.autosave.hasLocalChanges',
)

/** Mark the current in-memory notebook as the accepted clean baseline. */
function acceptCurrentBaseline(updatedAt: number): void {
  notebookBaseUpdatedAtAtom.set(updatedAt)
  savedRevisionAtom.set(notebookRevisionAtom())
}

/** Mark a concrete persisted document as the accepted clean baseline. */
function acceptStoredBaseline(updatedAt: number, revision: number): void {
  notebookBaseUpdatedAtAtom.set(updatedAt)
  savedRevisionAtom.set(revision)
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
  const snapshotRevision = notebookRevisionAtom()
  const snapshot = snapshotAfter(base ?? 0)
  const result = await wrap(notebookStorage.putIfNewer(snapshot, base))
  if (!result.ok) {
    saveStatusAtom.set('conflict')
    return
  }
  acceptStoredBaseline(snapshot.updatedAt, snapshotRevision)
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
  if (storageCompatibilityAtom() === 'newer-format') {
    saveStatusAtom.set('outdated')
    return
  }
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
  } catch (error) {
    if (error instanceof NewerFormatError) {
      storageCompatibilityAtom.set('newer-format')
      saveStatusAtom.set('outdated')
    } else {
      // Quota exceeded, blocked DB, private-mode restrictions — surface the
      // failure in the indicator but never let it crash the editor.
      saveStatusAtom.set('error')
    }
  } finally {
    saveInFlight = false
  }
}

/** Reload the latest stored notebook, discarding this tab's local version. */
export async function reloadFromStorage(): Promise<void> {
  try {
    const stored = await wrap(notebookStorage.get(LOCAL_NOTEBOOK_ID))
    if (!stored) return
    restoreNotebook(stored)
    acceptStoredBaseline(stored.updatedAt, notebookRevisionAtom())
    lastSavedAtAtom.set(Date.now())
    saveStatusAtom.set('saved')
  } catch (error) {
    // `get()` runs `applyMigrations`, so a notebook saved by a newer build
    // surfaces here too (this is reachable from the "Reload" button and from a
    // cross-tab pull). Block the downgrade instead of crashing on an unhandled
    // rejection; any other storage failure (quota / blocked DB) shows 'error'.
    if (error instanceof NewerFormatError) {
      storageCompatibilityAtom.set('newer-format')
      saveStatusAtom.set('outdated')
    } else {
      saveStatusAtom.set('error')
    }
  }
}

/** Force-write this tab's current version, replacing whatever another tab saved. */
export async function saveMine(): Promise<void> {
  if (storageCompatibilityAtom() === 'newer-format') {
    saveStatusAtom.set('outdated')
    return
  }
  saveStatusAtom.set('saving')
  try {
    const stored = await wrap(notebookStorage.get(LOCAL_NOTEBOOK_ID))
    const snapshotRevision = notebookRevisionAtom()
    const snapshot = snapshotAfter(
      Math.max(notebookBaseUpdatedAtAtom() ?? 0, stored?.updatedAt ?? 0),
    )
    await wrap(notebookStorage.put(snapshot))
    acceptStoredBaseline(snapshot.updatedAt, snapshotRevision)
    lastSavedAtAtom.set(Date.now())
    saveStatusAtom.set('saved')
    channel?.postSaved(snapshot.id, snapshot.updatedAt)
  } catch (error) {
    if (error instanceof NewerFormatError) {
      storageCompatibilityAtom.set('newer-format')
      saveStatusAtom.set('outdated')
    } else {
      saveStatusAtom.set('error')
    }
  }
}

/**
 * After boot, surface the saved indicator immediately when an EXISTING notebook
 * was restored from storage — seeded from its stored `updatedAt` — instead of
 * leaving the header blank until the first edit. Call this only when
 * `loadNotebook()` reported a real restore (returns `true`): a fresh seed has
 * nothing meaningful saved yet, and the newer-format gate already owns the
 * status, so both are intentionally left untouched.
 */
export function markBootRestored(): void {
  if (storageCompatibilityAtom() === 'newer-format') return
  const base = notebookBaseUpdatedAtAtom()
  if (base === null) return
  lastSavedAtAtom.set(base)
  saveStatusAtom.set('saved')
}

/**
 * Start autosaving for the app's lifetime. Subscribes to the content signal;
 * each change (re)arms a 500 ms timer, so only the last edit in a burst is
 * written. The first synchronous call on subscribe is skipped — loading a
 * notebook should not immediately re-save it. Returns an unsubscribe handle.
 */
let channel: ReturnType<typeof openCrossTabChannel> | null = null

async function handleExternalSave(updatedAt: number): Promise<void> {
  if (storageCompatibilityAtom() === 'newer-format') {
    saveStatusAtom.set('outdated')
    return
  }

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
  } catch (error) {
    if (error instanceof NewerFormatError) {
      storageCompatibilityAtom.set('newer-format')
      saveStatusAtom.set('outdated')
      return
    }
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
  if (storageCompatibilityAtom() === 'newer-format') {
    saveStatusAtom.set('outdated')
  }

  const runSave = wrap(() => {
    timer = null
    void saveNow()
  })

  const unsubscribe = notebookRevisionAtom.subscribe(() => {
    // Skip the initial synchronous emit: nothing has changed yet.
    if (!primed) {
      primed = true
      return
    }
    if (timer !== null) clearTimeout(timer)
    if (storageCompatibilityAtom() === 'newer-format') {
      saveStatusAtom.set('outdated')
      return
    }
    if (!hasLocalChangesAtom()) return
    timer = setTimeout(runSave, DEBOUNCE_MS)
  })

  // Cross-tab coordination assumes a shared backend — true for IndexedDB, where
  // same-origin tabs share the store. A per-instance memory backend (#136) is
  // isolated, so #136 must gate this channel by device mode before enabling it.
  channel = openCrossTabChannel(
    wrap((message) => {
      if (message.id !== LOCAL_NOTEBOOK_ID) return
      void handleExternalSave(message.updatedAt)
    }),
  )
  const unsubscribeFocusChecks = subscribeToFocusChecks()

  // Teardown drops the debounce timer, subscriptions and the cross-tab channel,
  // but does NOT cancel a save already in flight — that storage write runs to
  // completion by design. In-flight cancellation (AbortController) arrives with
  // #134's network-sync layer, where the window actually matters.
  return () => {
    if (timer !== null) clearTimeout(timer)
    unsubscribe()
    unsubscribeFocusChecks()
    channel?.close()
    channel = null
  }
}
