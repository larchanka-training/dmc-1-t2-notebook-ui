// Background remote autosync (#134): after the local autosave commits, push the
// notebook to the backend, queue offline/failed changes, propagate cell deletes
// via tombstones, and adopt the server's LWW-merged response as the new baseline.
//
// Design notes:
//   - Trigger is `localSaveCommittedAtom` (autosave), NOT the raw revision: a push
//     happens only AFTER the edit is persisted locally ("local first"), and never
//     for a boot/reload/cross-tab pull.
//   - The push reads the LOCALLY-PERSISTED doc, so it can only send what local
//     storage already holds (local-first by construction; INV-2: the first POST
//     carries the full cell list, never an empty body).
//   - Sync bookkeeping (the dirty flag + the deletedCells tombstone buffer) lives
//     in memory and is write-through-persisted to the storage adapter's sync
//     partition (#133), so it survives a reload and is wiped by clearAll().
//   - The layer NEVER inspects 401 or runs its own token refresh: `refreshMiddleware`
//     (client.ts) heals a transient 401 transparently. The only end-of-session
//     signal is `pauseRemoteSync()` (wired to `onSessionExpired` in setup.ts) — it
//     pauses pushes and never wipes local data.
//   - Reatom clearStack: every entry point is `wrap`-captured and every await is
//     `await wrap(promise)`, so atom reads/writes in continuations keep a stack.
//   - Cancellation: the notebook facade takes no AbortSignal, so a torn-down /
//     paused engine discards an in-flight push's result via a `generation` guard
//     rather than aborting the fetch. Wiring a real AbortSignal through the facade
//     is a follow-up.

import { atom, wrap } from '@reatom/core'
import { NetworkError, notebook as notebookApi } from '@/shared/api'
import { accessTokenAtom } from '@/entities/session'
import { notebookStorage } from '../persistence/activeStorage'
import { isNotebookJSON } from '../persistence/schema'
import type { NotebookSyncState } from '../persistence/storageAdapter'
import { cellsAtom, LOCAL_NOTEBOOK_ID } from './notebook'
import { hasLocalChangesAtom, localSaveCommittedAtom, reloadFromStorage } from './autosave'
import { isOnlineAtom, startOnlineTracking } from './online'
import {
  addTombstones,
  dropAckedTombstones,
  mergeSyncState,
  removedCellIds,
  retractTombstones,
  serverNotebookToJSON,
} from './remoteSyncCore'

export type RemoteSyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'paused' | 'error'

/** Separate from autosave's local debounce (500 ms) — coalesce more before the network. */
export const REMOTE_DEBOUNCE_MS = 1500
export const INITIAL_RETRY_MS = 2000
const MAX_RETRY_MS = 60_000

/** Coarse status for the UI (#135 surfaces it; the engine only needs internal state). */
export const remoteSyncStatusAtom = atom<RemoteSyncStatus>('idle', 'notebook.remoteSync.status')
/** True after `onSessionExpired` — pushes are paused until a fresh sign-in. */
export const pausedAtom = atom(false, 'notebook.remoteSync.paused')

let activeNotebookId: string | null = null
let syncState: NotebookSyncState | null = null
let previousCellIds = new Set<string>()
let unsubscribeSignal: (() => void) | null = null
let unsubscribeToken: (() => void) | null = null
let primedToken = false
let previousToken: string | null = null
let unsubscribeOnline: (() => void) | null = null
let onlineHandler: (() => void) | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryDelay = INITIAL_RETRY_MS
let pushInFlight = false
let pushAgain = false
let primed = false
// Bumped on teardown/pause and on each (re)start; an in-flight push compares it
// after every await and discards its result if it changed (cancellation guard).
let generation = 0
let flushDebouncedPush: (() => void) | null = null

function initialSyncState(notebookId: string): NotebookSyncState {
  return { notebookId, remoteCreated: false, dirty: false, deletedCells: [] }
}

function isAuthenticated(): boolean {
  return accessTokenAtom() !== null
}

function setStatus(status: RemoteSyncStatus): void {
  remoteSyncStatusAtom.set(status)
}

function armDebounce(): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => flushDebouncedPush?.(), REMOTE_DEBOUNCE_MS)
}

function clearRetry(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  retryDelay = INITIAL_RETRY_MS
}

function scheduleRetry(): void {
  if (retryTimer !== null) return // one pending retry at a time
  retryTimer = setTimeout(
    wrap(() => {
      retryTimer = null
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS)
      void pushNow()
    }),
    retryDelay,
  )
}

/** Write the in-memory sync-state through to the active backend's sync partition. */
function persistSyncState(): Promise<void> {
  return syncState ? notebookStorage.putSyncState(syncState) : Promise.resolve()
}

/**
 * Adopt the server's LWW-merged response as the new local baseline: persist it,
 * then reload the open notebook from storage (which restores the cells AND
 * re-accepts the clean baseline, so autosave does not immediately re-save and —
 * because reload does not bump `localSaveCommittedAtom` — this adoption does not
 * re-trigger a push). A malformed / newer-format response is not adopted.
 */
async function applyServerBaseline(
  notebookId: string,
  merged: notebookApi.Notebook,
): Promise<void> {
  const json = serverNotebookToJSON(merged)
  if (!isNotebookJSON(json)) return
  await wrap(notebookStorage.put(json))
  if (notebookId === LOCAL_NOTEBOOK_ID) await wrap(reloadFromStorage())
}

async function runOnePush(): Promise<void> {
  const notebookId = activeNotebookId
  if (notebookId === null || syncState === null) return
  if (pausedAtom()) {
    setStatus('paused')
    return
  }
  // Only authorized users sync. Signed out → engine idle, queue stays persisted.
  if (!isAuthenticated()) {
    setStatus('idle')
    return
  }
  if (!isOnlineAtom()) {
    setStatus('offline')
    scheduleRetry()
    return
  }
  if (!syncState.dirty && syncState.deletedCells.length === 0) {
    setStatus('synced')
    return
  }

  // Local-first: push exactly what local storage holds (INV-2: full doc incl. cells).
  const stored = await wrap(notebookStorage.get(notebookId))
  if (!stored) {
    setStatus('idle')
    return
  }

  const myGeneration = generation
  const sentSeq = localSaveCommittedAtom()
  const sentState = syncState
  const sentTombstoneIds = sentState.deletedCells.map((t) => t.id)

  setStatus('syncing')
  try {
    const merged = sentState.remoteCreated
      ? await wrap(
          notebookApi.patch(notebookId, {
            title: stored.title,
            formatVersion: stored.formatVersion,
            cells: stored.cells,
            deletedCells: sentState.deletedCells,
          }),
        )
      : await wrap(
          notebookApi.create({
            id: stored.id,
            title: stored.title,
            formatVersion: stored.formatVersion,
            cells: stored.cells,
          }),
        )

    // Discard the result if the engine was torn down / paused during the await.
    if (myGeneration !== generation) return

    clearRetry()
    // A local save that committed while the request was in flight keeps us dirty
    // and means the merged response is stale (don't apply it; re-push instead).
    const newerLocal = localSaveCommittedAtom() !== sentSeq
    syncState = {
      notebookId,
      remoteCreated: true,
      dirty: newerLocal,
      // Drop only the tombstones we actually sent; keep any added in flight.
      deletedCells: dropAckedTombstones(syncState.deletedCells, sentTombstoneIds),
    }
    await wrap(persistSyncState())

    // INV-3: adopt the merged server doc as the new baseline ONLY when the
    // in-memory notebook is clean and nothing newer committed — otherwise the
    // user's fresher edits would be clobbered.
    if (!hasLocalChangesAtom() && !newerLocal) {
      await wrap(applyServerBaseline(notebookId, merged))
    }
    if (myGeneration !== generation) return

    if (syncState.dirty) {
      setStatus('syncing')
      pushAgain = true
    } else {
      setStatus('synced')
    }
  } catch (error) {
    if (myGeneration !== generation) return
    // Never parse 401 / never refresh here (refreshMiddleware owns that). Any
    // failure — NetworkError, 5xx, even a 401 that slipped through — is an ordinary
    // failed request: keep the queue (dirty + tombstones untouched) and retry. It
    // is NOT end-of-session; only onSessionExpired pauses.
    setStatus(error instanceof NetworkError ? 'offline' : 'error')
    scheduleRetry()
  }
}

async function pushNow(): Promise<void> {
  if (pushInFlight) {
    pushAgain = true
    return
  }
  pushInFlight = true
  try {
    do {
      pushAgain = false
      await wrap(runOnePush())
    } while (pushAgain && !pausedAtom() && isAuthenticated() && isOnlineAtom())
  } finally {
    pushInFlight = false
  }
}

async function loadStateAndFlush(notebookId: string): Promise<void> {
  const loaded = await wrap(notebookStorage.getSyncState(notebookId))
  if (activeNotebookId !== notebookId) return
  // Merge, don't clobber: a local save during the load window already recorded
  // dirty/tombstones into the provisional state — union them with the loaded
  // record instead of letting a clean record overwrite the change (H-2).
  const provisional = syncState ?? initialSyncState(notebookId)
  syncState = loaded ? mergeSyncState(loaded, provisional) : provisional
  if (syncState.dirty || syncState.deletedCells.length > 0) void pushNow()
}

function onLocalSaveCommitted(): void {
  if (!primed) {
    // Skip the synchronous first emit on subscribe — nothing changed yet.
    primed = true
    return
  }
  const currentIds = cellsAtom().map((c) => c.id)
  const removed = removedCellIds(previousCellIds, currentIds)
  previousCellIds = new Set(currentIds)
  if (syncState) {
    // Add tombstones for cells deleted since the last commit, and retract any
    // whose id is present again (delete→undo restores the same id) — otherwise
    // the next PATCH would carry the cell AND a tombstone for it.
    const withAdded = addTombstones(syncState.deletedCells, removed, Date.now())
    syncState = {
      ...syncState,
      dirty: true,
      deletedCells: retractTombstones(withAdded, currentIds),
    }
    void wrap(persistSyncState())
  }
  armDebounce()
}

/**
 * Start the background sync for `notebookId` for the app's lifetime. Idempotent
 * re-init: a fresh call (e.g. after re-login) resets pause and re-flushes the
 * queue. Returns an unsubscribe. The engine self-guards on auth, so it is safe to
 * start while signed out — it stays idle and flushes once a token exists.
 */
export function startRemoteSync(notebookId: string): () => void {
  // Idempotent re-init (H-3): drop any prior engine's listeners/subscription/timers
  // before re-wiring, so a repeated start (e.g. #135's re-login) does not leak a
  // second save subscription or duplicate window listeners.
  teardownRemoteSync()
  activeNotebookId = notebookId
  syncState = initialSyncState(notebookId) // provisional until the load resolves
  pausedAtom.set(false)
  generation += 1
  primed = false
  pushInFlight = false
  pushAgain = false
  previousCellIds = new Set(cellsAtom().map((c) => c.id))
  retryDelay = INITIAL_RETRY_MS
  setStatus('idle')

  unsubscribeOnline = startOnlineTracking()
  onlineHandler = wrap(() => {
    if (isOnlineAtom()) {
      clearRetry()
      void pushNow()
    }
  })
  if (typeof window !== 'undefined') window.addEventListener('online', onlineHandler)

  flushDebouncedPush = wrap(() => {
    debounceTimer = null
    void pushNow()
  })

  void wrap(loadStateAndFlush(notebookId))

  unsubscribeSignal = localSaveCommittedAtom.subscribe(wrap(onLocalSaveCommitted))
  // Resume + flush on a fresh sign-in: a change queued while signed out (the
  // engine stayed idle on the `!isAuthenticated` guard) is sent once a token
  // appears, and a paused engine resumes. Only a null→token transition triggers
  // it (a token→null sign-out does not push).
  primedToken = false
  previousToken = null
  unsubscribeToken = accessTokenAtom.subscribe(
    wrap(() => {
      const token = accessTokenAtom()
      const was = previousToken
      previousToken = token
      if (!primedToken) {
        primedToken = true
        return
      }
      if (token !== null && was === null) {
        pausedAtom.set(false)
        clearRetry()
        void pushNow()
      }
    }),
  )
  return teardownRemoteSync
}

function teardownRemoteSync(): void {
  generation += 1 // discard any in-flight push result
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  clearRetry()
  unsubscribeSignal?.()
  unsubscribeSignal = null
  unsubscribeToken?.()
  unsubscribeToken = null
  if (onlineHandler && typeof window !== 'undefined') {
    window.removeEventListener('online', onlineHandler)
  }
  onlineHandler = null
  unsubscribeOnline?.()
  unsubscribeOnline = null
  flushDebouncedPush = null
  activeNotebookId = null
}

/**
 * Pause syncing on `onSessionExpired` (refresh already failed — a real re-login is
 * needed). Stops pending/in-flight pushes WITHOUT wiping local data: the queue
 * persists and flushes after the next sign-in. The engine never decides this from
 * a 401 itself — only this explicit signal pauses it.
 */
export function pauseRemoteSync(): void {
  pausedAtom.set(true)
  generation += 1
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  clearRetry()
  setStatus('paused')
}
