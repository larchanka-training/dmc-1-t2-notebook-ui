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
import { ApiError, NetworkError, notebook as notebookApi, RateLimitedError } from '@/shared/api'
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

export type RemoteSyncStatus =
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'offline'
  | 'paused'
  | 'error' // transient/recoverable — a retry is armed or a later trigger re-pushes
  | 'failed' // terminal (e.g. a permanent 4xx) — queue kept, no auto-retry loop

/** Separate from autosave's local debounce (500 ms) — coalesce more before the network. */
export const REMOTE_DEBOUNCE_MS = 1500
export const INITIAL_RETRY_MS = 2000
const MAX_RETRY_MS = 60_000
/** Backoff for re-attempting a failed sync-metadata write (queue durability). */
export const PERSIST_RETRY_MS = 2000

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
let persistRetryTimer: ReturnType<typeof setTimeout> | null = null
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

/** Cancel a pending retry timer WITHOUT resetting the backoff delay. */
function cancelRetryTimer(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
}

/** Cancel a pending retry AND reset the backoff — only on a successful push / fresh session. */
function resetRetry(): void {
  cancelRetryTimer()
  retryDelay = INITIAL_RETRY_MS
}

/**
 * Arm a single delayed retry with exponential backoff (capped). `delayOverride`
 * (ms) honours a server `Retry-After`. The backoff grows per scheduled retry and
 * is reset only by a successful push — NOT on every `online` edge — so a flapping
 * connection can't hammer a throttling server.
 */
function scheduleRetry(delayOverride?: number): void {
  if (retryTimer !== null) return // one pending retry at a time
  const delay = Math.max(delayOverride ?? 0, retryDelay)
  retryTimer = setTimeout(
    wrap(() => {
      retryTimer = null
      void pushNow()
    }),
    delay,
  )
  retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS)
}

/**
 * Retryable: no HTTP answer (network), a transient HTTP status (5xx / 408 / 429),
 * or a 401 — which the issue mandates be treated as an ordinary failed request
 * (keep the queue, retry), NOT as end-of-session (only onSessionExpired pauses).
 * Deterministic 4xx (400/403/404/409/422) are terminal: the server rejects this
 * body every time, so looping would never succeed and would hide a real bug.
 */
function isRetryable(error: unknown): boolean {
  if (error instanceof NetworkError) return true
  if (error instanceof ApiError) {
    const s = error.status
    return s >= 500 || s === 408 || s === 429 || s === 401
  }
  return true // unknown error shape — retry rather than get permanently stuck
}

/** The server-requested delay (ms) for a 429, if present. */
function retryAfterMs(error: unknown): number | undefined {
  if (error instanceof RateLimitedError && error.retryAfter !== undefined) {
    return error.retryAfter * 1000
  }
  return undefined
}

/**
 * Write the in-memory sync-state through to the active backend's sync partition.
 * Never rejects: a failed write (quota / blocked DB) is logged and a retry is
 * scheduled, so the dirty flag + tombstone queue is not silently lost before the
 * next push (queue durability — review A-4).
 */
async function persistSyncState(): Promise<void> {
  if (!syncState) return
  try {
    await wrap(notebookStorage.putSyncState(syncState))
  } catch (error) {
    console.error('remoteSync: failed to persist sync metadata; scheduling a retry', error)
    if (persistRetryTimer === null) {
      persistRetryTimer = setTimeout(
        wrap(() => {
          persistRetryTimer = null
          void persistSyncState()
        }),
        PERSIST_RETRY_MS,
      )
    }
  }
}

/** Outcome of trying to adopt the server's merged response as the local baseline. */
type AdoptResult =
  | 'applied' // adopted as the new baseline
  | 'deferred' // transient block (concurrent edit / newer storage) — keep local, re-push
  | 'rejected' // suspect response (malformed / would-zero) — keep local, do not auto-loop

/**
 * Adopt the server's LWW-merged response as the new local baseline: persist it
 * (compare-and-swap so a newer version is not clobbered), then reload the open
 * notebook from storage (which restores the cells AND re-accepts the clean
 * baseline, so autosave does not immediately re-save and — because reload does
 * not bump `localSaveCommittedAtom` — this adoption does not re-trigger a push).
 *
 * Refuses adoption (returns non-`applied`, keeping local intact) when: the
 * response is malformed/newer-format; it would zero a non-empty notebook (M-3); a
 * concurrent local edit is present before or during the write (M-1); or storage
 * already holds a version newer than the one this push was based on (another tab).
 */
async function applyServerBaseline(
  notebookId: string,
  merged: notebookApi.Notebook,
  base: number,
  pushedNonEmpty: boolean,
): Promise<AdoptResult> {
  const json = serverNotebookToJSON(merged)
  if (!isNotebookJSON(json)) {
    console.warn('remoteSync: server response is not a valid notebook; keeping local')
    return 'rejected'
  }
  // M-3: never let a well-formed empty-cells response zero a non-empty notebook.
  if (json.cells.length === 0 && pushedNonEmpty) {
    console.warn('remoteSync: server returned 0 cells for a non-empty notebook; keeping local')
    return 'rejected'
  }
  // M-1: don't adopt over a concurrent local edit — checked before any write, so
  // neither storage nor editor is touched while the user is mid-edit.
  if (notebookId === LOCAL_NOTEBOOK_ID && hasLocalChangesAtom()) return 'deferred'
  // Storage CAS: refuse to clobber a version newer than the one this push was
  // based on (e.g. another tab saved during the PATCH) instead of an unconditional put.
  const result = await wrap(notebookStorage.putIfNewer(json, base))
  if (!result.ok) return 'deferred'
  if (notebookId === LOCAL_NOTEBOOK_ID) {
    // Re-check after the write: a keystroke during the put must not be clobbered
    // by the wholesale reload (it survives in the editor; autosave reconciles).
    if (hasLocalChangesAtom()) return 'deferred'
    await wrap(reloadFromStorage())
  }
  return 'applied'
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

  // Capture the generation BEFORE the first await, so a teardown/pause during the
  // storage read is detected and we never issue HTTP for a dead engine.
  const myGeneration = generation
  // Local-first: push exactly what local storage holds (INV-2: full doc incl. cells).
  const stored = await wrap(notebookStorage.get(notebookId))
  if (myGeneration !== generation) return
  if (!stored) {
    setStatus('idle')
    return
  }

  const sentSeq = localSaveCommittedAtom()
  const sentState = syncState
  const sentTombstoneIds = sentState.deletedCells.map((t) => t.id)

  setStatus('syncing')
  try {
    let merged: notebookApi.Notebook
    if (sentState.remoteCreated) {
      merged = await wrap(
        notebookApi.patch(notebookId, {
          title: stored.title,
          formatVersion: stored.formatVersion,
          cells: stored.cells,
          deletedCells: sentState.deletedCells,
        }),
      )
    } else {
      try {
        merged = await wrap(
          notebookApi.create({
            id: stored.id,
            title: stored.title,
            formatVersion: stored.formatVersion,
            cells: stored.cells,
          }),
        )
      } catch (error) {
        // A 409 on create means the notebook already exists under us: the POST
        // committed server-side but its ack was lost, then an edit made the
        // re-POSTed content differ (backend `_matches_create_payload`). Adopt it
        // as created and re-push as PATCH (which LWW-merges) instead of wedging on
        // a terminal 409 forever — the create-ack/409 family (review C-1/C-2).
        if (error instanceof ApiError && error.status === 409) {
          if (myGeneration !== generation) return
          syncState = { ...syncState, remoteCreated: true, dirty: true }
          await wrap(persistSyncState())
          pushAgain = true
          return
        }
        throw error
      }
    }

    // Discard the result if the engine was torn down / paused during the await.
    if (myGeneration !== generation) return

    resetRetry()
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
      const result = await wrap(
        applyServerBaseline(notebookId, merged, stored.updatedAt, stored.cells.length > 0),
      )
      if (myGeneration !== generation) return
      if (result !== 'applied') {
        // Keep local authoritative and stay dirty so the change reconverges.
        syncState = { ...syncState, dirty: true }
        await wrap(persistSyncState())
        if (result === 'deferred') {
          // Transient (concurrent edit / newer storage) — re-push after a delay.
          setStatus('syncing')
          scheduleRetry()
        } else {
          // 'rejected' (suspect empty/malformed response) — surface, don't auto-loop.
          setStatus('error')
        }
        return
      }
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
    // Never parse 401 / never refresh here (refreshMiddleware owns that). The queue
    // (dirty + tombstones) is kept on EVERY failure, so nothing is ever lost. It is
    // never treated as end-of-session — only onSessionExpired pauses.
    if (isRetryable(error)) {
      // No HTTP answer, a 5xx, 408, or 429 — retry with backoff (honouring a 429
      // Retry-After). A 401 that slipped past refreshMiddleware lands here too and
      // is retried, not paused.
      setStatus(error instanceof NetworkError ? 'offline' : 'error')
      scheduleRetry(retryAfterMs(error))
    } else {
      // A permanent 4xx (400/403/404/409/422): the server rejects this body every
      // time, so do NOT loop forever (which would also hide a real bug behind a
      // false 'synced'). Keep the queue and surface a terminal status. A shared-id
      // 403 lands here — see docs/architecture/remote-sync.md "per-owner id".
      setStatus('failed')
    }
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
    void persistSyncState() // self-handles errors + retry
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
      // Cancel the pending retry timer but keep the backoff: a flapping connection
      // must not reset to the 2s floor on every online edge.
      cancelRetryTimer()
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
        resetRetry()
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
  if (persistRetryTimer !== null) {
    clearTimeout(persistRetryTimer)
    persistRetryTimer = null
  }
  resetRetry()
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
  resetRetry()
  setStatus('paused')
}
