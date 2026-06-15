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
  activeNotebookIdAtom,
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

/**
 * Monotonic counter bumped after every user-driven local save commits (the
 * debounced autosave or "Save mine"). The remote autosync layer (#134)
 * subscribes to this as its push trigger: a server push happens only AFTER the
 * edit is persisted locally ("local first"), and NOT on boot / reload / cross-tab
 * pull — those restore content from elsewhere rather than originate a local edit,
 * so re-pushing them would be wasteful (and risks bouncing a just-pulled version
 * back to the server).
 */
export const localSaveCommittedAtom = atom(0, 'notebook.autosave.localSaveCommitted')

function markLocalSaveCommitted(): void {
  localSaveCommittedAtom.set((seq) => seq + 1)
}

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
// The currently running save loop, or null when idle. Exposed via `drainAutosave`
// so the slot controller (#135) can await an in-flight write before switching the
// active notebook id — otherwise the flip could retarget a mid-flight write to the
// new id.
let currentSave: Promise<void> | null = null

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
  markLocalSaveCommitted()
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
    // Await the running loop instead of resolving early, so a caller that needs
    // the write to land (e.g. `drainAutosave` on a slot switch) actually waits.
    if (currentSave) await currentSave
    return
  }

  currentSave = runSaveLoop()
  try {
    await currentSave
  } finally {
    currentSave = null
  }
}

async function runSaveLoop(): Promise<void> {
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

/**
 * Reload the latest stored notebook, discarding this tab's local version. Returns
 * `true` only when the editor was actually restored, so a caller (remote-sync
 * baseline adoption) can avoid reporting `synced` when the in-memory restore failed
 * (review veai A-2).
 */
export async function reloadFromStorage(): Promise<boolean> {
  try {
    const stored = await wrap(notebookStorage.get(activeNotebookIdAtom()))
    if (!stored) return false
    restoreNotebook(stored)
    acceptStoredBaseline(stored.updatedAt, notebookRevisionAtom())
    lastSavedAtAtom.set(Date.now())
    saveStatusAtom.set('saved')
    return true
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
    return false
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
    const stored = await wrap(notebookStorage.get(activeNotebookIdAtom()))
    const snapshotRevision = notebookRevisionAtom()
    const snapshot = snapshotAfter(
      Math.max(notebookBaseUpdatedAtAtom() ?? 0, stored?.updatedAt ?? 0),
    )
    await wrap(notebookStorage.put(snapshot))
    acceptStoredBaseline(snapshot.updatedAt, snapshotRevision)
    lastSavedAtAtom.set(Date.now())
    saveStatusAtom.set('saved')
    channel?.postSaved(snapshot.id, snapshot.updatedAt)
    markLocalSaveCommitted()
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

// Set by the active autosave subscription: synchronously promotes a pending
// debounced save so it runs now instead of 500 ms later. `drainAutosave` calls it
// before a slot switch; null while autosave is not running.
let flushPendingSave: (() => void) | null = null

// The teardown handle of the live autosave instance, or null when stopped. Used
// to make `startAutosave` teardown-first (mirroring `startRemoteSync`): a repeated
// start (slot switch, HMR, test re-init) must stop the previous instance before
// re-arming, otherwise the old `notebookRevisionAtom` subscription, focus/
// visibility listeners and BroadcastChannel leak and double-write for the session.
let activeAutosaveTeardown: (() => void) | null = null

/**
 * Flush a pending debounced save and await any in-flight write. The slot
 * controller (#135) awaits this BEFORE flipping `activeNotebookIdAtom`, so the
 * previous notebook's edits are persisted under its own id and no write is still
 * running across the id change. Safe to call when autosave is stopped (no pending
 * flush, no in-flight save) — it then resolves immediately.
 */
export async function drainAutosave(): Promise<void> {
  flushPendingSave?.()
  if (currentSave) await currentSave
}

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
    const stored = await wrap(notebookStorage.get(activeNotebookIdAtom()))
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
  // Teardown-first (H-3, mirrors startRemoteSync): drop any prior instance's
  // subscription / listeners / channel before wiring a new one, so a repeated
  // start cannot leak a second autosave or a second cross-tab channel.
  activeAutosaveTeardown?.()

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
      if (message.id !== activeNotebookIdAtom()) return
      void handleExternalSave(message.updatedAt)
    }),
  )
  const unsubscribeFocusChecks = subscribeToFocusChecks()

  // Expose a synchronous flush of the pending debounce so a slot switch can force
  // the last edit to persist now (via `drainAutosave`) rather than lose it to the
  // teardown's `clearTimeout`. No pending timer / newer-format / clean editor are
  // all no-ops, mirroring the subscription's own guards.
  flushPendingSave = () => {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
    if (storageCompatibilityAtom() === 'newer-format') return
    if (!hasLocalChangesAtom()) return
    void saveNow()
  }

  // Teardown drops the debounce timer, subscriptions and the cross-tab channel.
  // It no longer silently discards a pending edit: a slot switch first calls
  // `drainAutosave` (flush + await) so the write lands under the old id. A bare
  // teardown without a drain still cancels the timer (the unflushed edit stays in
  // the editor and re-arms on the next change), matching the pre-#135 behaviour.
  const teardown = () => {
    // Always tear down THIS instance's own per-instance resources (timer +
    // subscriptions are captured in this closure, so this is safe even for a
    // stale handle).
    if (timer !== null) clearTimeout(timer)
    unsubscribe()
    unsubscribeFocusChecks()
    // The cross-tab channel and the flush pointer are MODULE-level singletons
    // shared with whatever instance is currently live. Only touch them if THIS
    // instance is still the live one (L2): a stale teardown running after a newer
    // `startAutosave()` must not close the live channel or wipe the live flush
    // pointer (which would silently disable cross-tab sync + drain-flush).
    if (activeAutosaveTeardown === teardown) {
      flushPendingSave = null
      channel?.close()
      channel = null
      activeAutosaveTeardown = null
    }
  }
  activeAutosaveTeardown = teardown
  return teardown
}
