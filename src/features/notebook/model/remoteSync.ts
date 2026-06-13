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
//   - Cancellation: each push gets an AbortController whose signal is threaded
//     through the facade; pause/teardown/sign-out abort the in-flight request AND
//     bump the `generation` (which discards a late result), so a hung request can't
//     keep `pushInFlight` true and block later sync.

import { atom, wrap } from '@reatom/core'
import { ApiError, NetworkError, notebook as notebookApi, RateLimitedError } from '@/shared/api'
import { accessTokenAtom, userAtom } from '@/entities/session'
import { notebookStorage } from '../persistence/activeStorage'
import { NewerFormatError } from '../persistence/migrations'
import { isNotebookJSON, type NotebookJSON } from '../persistence/schema'
import { MAX_DELETED_CELLS, type NotebookSyncState } from '../persistence/storageAdapter'
import { cellsAtom, LOCAL_NOTEBOOK_ID, notebookBaseUpdatedAtAtom } from './notebook'
import { notebookRestoredAtom } from './revision'
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
// Backend request limits (vendored OpenAPI): a larger payload deterministically
// 422s, which `isRetryable` treats as a silent terminal `failed`. Preflighted so
// the reason is diagnosable and local stays intact (review opus M3 + veai B-3).
const MAX_SYNCABLE_CELLS = 500 // `cells` maxItems
const MAX_TITLE_LEN = 255 // `title` maxLength
const MAX_CELL_CONTENT_LEN = 262144 // `content` maxLength
const MAX_AUTOSYNC_PAYLOAD_BYTES = 1_000_000

/** Coarse status for the UI (#135 surfaces it; the engine only needs internal state). */
export const remoteSyncStatusAtom = atom<RemoteSyncStatus>('idle', 'notebook.remoteSync.status')
/** True after `onSessionExpired` — pushes are paused until a fresh sign-in. */
export const pausedAtom = atom(false, 'notebook.remoteSync.paused')

let activeNotebookId: string | null = null
let syncState: NotebookSyncState | null = null
let previousCellIds = new Set<string>()
let unsubscribeSignal: (() => void) | null = null
let unsubscribeRestored: (() => void) | null = null
let primedRestored = false
let unsubscribeToken: (() => void) | null = null
let primedToken = false
let previousToken: string | null = null
let unsubscribeUser: (() => void) | null = null
let primedUser = false
// A-1: a local save committed while the access token is present but `userAtom`
// has not hydrated yet is stamped with no ownerId. We record the EXACT access
// token in flight at that moment; the userAtom-hydration handler then attributes
// the queue only if that same token is still current — binding the pending
// attribution to one session. If the token rotated or was replaced (a different
// account) in between, we do NOT stamp (so content is never uploaded under the
// wrong account); the save self-heals on the next edit. `null` when nothing is
// awaiting attribution. Cleared on sign-out and reset on (re)start.
let ownerHydrationToken: string | null = null
let unsubscribeOnline: (() => void) | null = null
let onlineHandler: (() => void) | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let persistRetryTimer: ReturnType<typeof setTimeout> | null = null
let loadRetryTimer: ReturnType<typeof setTimeout> | null = null
let retryDelay = INITIAL_RETRY_MS
let retryDueAt = 0 // Date.now()+delay of the pending retry, so a later 429 can extend it
// False until the durable sync metadata has been read (or confirmed absent). While
// false, nothing persists or pushes — a read FAILURE leaves the durable queue
// unknown, and writing a fresh provisional state would clobber it (review A-1).
let metadataLoaded = false
let pushInFlight = false
let pushAgain = false
// Aborts the in-flight push's HTTP request on pause / teardown / sign-out, so a
// hung request can't keep `pushInFlight` true and block all later sync (review B-2).
let currentAbort: AbortController | null = null
let primed = false
// Bumped on teardown/pause and on each (re)start; an in-flight push compares it
// after every await and discards its result if it changed (cancellation guard).
let generation = 0
// Bumped ONLY on (re)start (not pause/teardown), so a teardown handle can tell
// "my engine is still the active one" apart from a pause (C-8).
let startEpoch = 0
let flushDebouncedPush: (() => void) | null = null

function initialSyncState(notebookId: string): NotebookSyncState {
  return { notebookId, remoteCreated: false, dirty: false, deletedCells: [] }
}

function isAuthenticated(): boolean {
  return accessTokenAtom() !== null
}

/** The current signed-in account id, or `undefined` if not known yet. */
function currentOwnerId(): string | undefined {
  return userAtom()?.id
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
  retryDueAt = 0
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
  // Known follow-up (#135, low priority): a retry timer that fires while offline
  // re-arms here and grows the backoff with no server contact (opus L3).
  const delay = Math.max(delayOverride ?? 0, retryDelay)
  const dueAt = Date.now() + delay
  if (retryTimer !== null) {
    // One pending retry, but a later server-requested delay (a larger 429
    // Retry-After) extends it rather than being dropped (review opus L4 / gpt).
    if (dueAt <= retryDueAt) return
    clearTimeout(retryTimer)
  }
  retryDueAt = dueAt
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
  // Unknown error shape (e.g. a programming TypeError): retry rather than get
  // permanently stuck. Deliberate MVP trade-off — a real code bug would loop under
  // backoff (logged each attempt via the push-failed warn) instead of surfacing.
  // A retry cap / terminal-on-non-ApiError is a documented follow-up (#135).
  return true
}

/** The server-requested delay (ms) for a 429, if present. */
function retryAfterMs(error: unknown): number | undefined {
  if (error instanceof RateLimitedError && error.retryAfter !== undefined) {
    return error.retryAfter * 1000
  }
  return undefined
}

function autosyncPayloadBytes(payload: unknown): number {
  return new Blob([JSON.stringify(payload)]).size
}

// Cheap lower bound on the serialized payload size, in bytes: every UTF-16 code
// unit is at least one UTF-8 byte and JSON structure (quotes, keys, commas) only
// adds more, so the real size is always ≥ the summed code-unit length of the
// variable-length fields. When even this lower bound exceeds the cap the payload
// is definitely too large, so the caller can reject WITHOUT the exact
// `autosyncPayloadBytes` — which would otherwise materialize a multi-MB JSON
// string + Blob on the UI thread just to learn it is oversized. `.length` is O(1)
// per string, so this stays bounded even for a pathological notebook.
function payloadByteLowerBound(stored: NotebookJSON): number {
  let units = stored.title.length
  for (const cell of stored.cells) units += cell.id.length + cell.content.length
  return units
}

function codePointLength(value: string): number {
  return Array.from(value).length
}

/**
 * Write the in-memory sync-state through to the active backend's sync partition.
 * Never rejects: a failed write (quota / blocked DB) is logged and a retry is
 * scheduled, so the dirty flag + tombstone queue is not silently lost before the
 * next push (queue durability — review A-4).
 */
async function persistSyncState(): Promise<void> {
  if (!syncState) return
  const myGeneration = generation
  try {
    await wrap(notebookStorage.putSyncState(syncState))
  } catch (error) {
    // Don't reschedule for a torn-down / paused engine — a stale write-after-clear
    // must not be resurrected (matters once #136 wires clearLocalNotebookData to
    // sign-out; C-7).
    if (myGeneration !== generation) return
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
  // C-6: the response is untrusted (§11). Reject an id that is not the notebook we
  // pushed BEFORE mapping/writing — otherwise a misbehaving 2xx echoing a different
  // id would write a phantom record keyed by that id.
  if (merged.id !== notebookId) {
    console.warn('remoteSync: server response id does not match the notebook; keeping local')
    return 'rejected'
  }
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
    if (hasLocalChangesAtom()) {
      // C-3: storage now holds the server baseline (`json.updatedAt`), but the
      // editor is newer. Advance the autosave CAS base to the written version so
      // the pending autosave saves the keystroke cleanly on top — without this the
      // next `putIfNewer(snapshot, staleBase)` would false-`conflict` against the
      // version we just wrote. The keystroke is preserved and re-pushed.
      notebookBaseUpdatedAtAtom.set(json.updatedAt)
      return 'deferred'
    }
    // A-2: if the editor reload fails (storage read error / newer-format), the open
    // editor still shows the pre-merge state — don't claim 'applied'; keep it
    // dirty/retryable so sync doesn't report a false 'synced'.
    const reloaded = await wrap(reloadFromStorage())
    if (!reloaded) return 'deferred'
  }
  return 'applied'
}

async function runOnePush(): Promise<void> {
  const notebookId = activeNotebookId
  if (notebookId === null || syncState === null) return
  // Hold off until the durable metadata is loaded — pushing the provisional state
  // (without the real remoteCreated / ownerId / tombstones) would be wrong; the
  // pending load retry flushes once it succeeds (A-1).
  if (!metadataLoaded) return
  if (pausedAtom()) {
    setStatus('paused')
    return
  }
  // Only authorized users sync. Signed out → engine idle, queue stays persisted.
  if (!isAuthenticated()) {
    setStatus('idle')
    return
  }
  // Cross-account safety: auto-upload ONLY a queue we can positively attribute to
  // the current signed-in user. A queue with no `ownerId` (made while signed out)
  // or a different owner is never auto-pushed on a shared device — anonymous /
  // previous-user content must not land in whoever signs in next; the explicit
  // import/keep/discard flow for unattributed local data is #136's device-mode job.
  // A concrete `userAtom().id` is required (not just a token); the userAtom
  // subscription re-attempts once identity hydrates (A-3).
  // Two accounts contested the shared local notebook (detected during merge) — never
  // auto-push it under either; #136 device-mode resolves which content belongs to whom.
  if (syncState.ownerConflict) {
    console.warn('remoteSync: local notebook has an unresolved owner conflict; not pushing')
    setStatus('failed')
    return
  }
  const owner = currentOwnerId()
  if (owner === undefined || syncState.ownerId !== owner) {
    console.warn('remoteSync: queued change is not attributable to the current user; not pushing')
    setStatus('idle')
    return
  }
  if (!isOnlineAtom()) {
    // Don't arm a retry timer while offline — it would re-enter this branch and grow
    // the backoff with no server contact. The `online` event flushes on reconnect and
    // the next committed edit re-triggers (review gpt B-3 / opus L3).
    setStatus('offline')
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
  // The read is in its own try so a storage failure doesn't escape as an unhandled
  // rejection with no status/retry (review veai High).
  let stored: NotebookJSON | undefined
  try {
    stored = await wrap(notebookStorage.get(notebookId))
  } catch (error) {
    if (myGeneration !== generation) return
    if (error instanceof NewerFormatError) {
      // Local doc is from a newer app version — never upload a format we can't
      // understand (the autosave newer-format gate owns the user-facing state).
      console.warn('remoteSync: local notebook is a newer format; not pushing', error)
      setStatus('error')
      return
    }
    // Transient read failure (blocked DB / quota) — keep the queue and retry.
    console.warn('remoteSync: failed to read the local notebook; will retry', error)
    setStatus('error')
    scheduleRetry()
    return
  }
  if (myGeneration !== generation) return
  if (!stored) {
    setStatus('idle')
    return
  }
  // Preflight the backend request limits — a larger payload would 422 → silent
  // terminal `failed`. Refuse up front with a distinct log; keep local intact.
  const overLimit =
    stored.cells.length > MAX_SYNCABLE_CELLS
      ? `${stored.cells.length} cells (> ${MAX_SYNCABLE_CELLS})`
      : codePointLength(stored.title) > MAX_TITLE_LEN
        ? `title length ${codePointLength(stored.title)} (> ${MAX_TITLE_LEN})`
        : stored.cells.some((c) => codePointLength(c.content) > MAX_CELL_CONTENT_LEN)
          ? `a cell over ${MAX_CELL_CONTENT_LEN} chars`
          : // Hard cap on the tombstone buffer (review gpt B-2): fail with a diagnosable
            // terminal state instead of building a pathological PATCH body on offline
            // delete churn. A real compaction / per-backend contract is a #135 follow-up.
            syncState.tombstonesOverflow || syncState.deletedCells.length > MAX_DELETED_CELLS
            ? `${syncState.deletedCells.length} tombstones (> ${MAX_DELETED_CELLS})`
            : null
  if (overLimit !== null) {
    console.warn(`remoteSync: payload exceeds a backend limit (${overLimit}); not pushing`)
    setStatus('failed')
    return
  }

  const sentSeq = localSaveCommittedAtom()
  const sentState = syncState
  // C-1: never send a tombstone for a cell that is still in the pushed document
  // (a deletion made in-memory after this doc was persisted, before its own save
  // committed) — body and tombstones must agree on the same persisted moment.
  const storedCellIds = new Set(stored.cells.map((c) => c.id))
  const sendableTombstones = retractTombstones(sentState.deletedCells, storedCellIds)
  const sentTombstoneIds = sentState.remoteCreated
    ? sendableTombstones.map((t) => t.id) // PATCH actually sent these
    : sentState.deletedCells.map((t) => t.id) // create: pre-sync tombstones are moot, drop all
  const requestBody = sentState.remoteCreated
    ? {
        title: stored.title,
        formatVersion: stored.formatVersion,
        cells: stored.cells,
        deletedCells: sendableTombstones,
      }
    : {
        id: stored.id,
        title: stored.title,
        formatVersion: stored.formatVersion,
        cells: stored.cells,
      }
  // Short-circuit a clearly-oversized notebook on the cheap lower bound so the
  // exact JSON.stringify + Blob (a multi-MB UI-thread allocation) never runs; the
  // exact count stays authoritative for a borderline multibyte payload.
  const lowerBound = payloadByteLowerBound(stored)
  if (lowerBound > MAX_AUTOSYNC_PAYLOAD_BYTES) {
    console.warn(
      `remoteSync: autosync payload is too large (≥ ${lowerBound} bytes > ` +
        `${MAX_AUTOSYNC_PAYLOAD_BYTES}); not pushing`,
    )
    setStatus('failed')
    return
  }
  const payloadBytes = autosyncPayloadBytes(requestBody)
  if (payloadBytes > MAX_AUTOSYNC_PAYLOAD_BYTES) {
    console.warn(
      `remoteSync: autosync payload is too large (${payloadBytes} bytes > ` +
        `${MAX_AUTOSYNC_PAYLOAD_BYTES}); not pushing`,
    )
    setStatus('failed')
    return
  }

  const myAbort = new AbortController()
  currentAbort = myAbort
  setStatus('syncing')
  try {
    let merged: notebookApi.Notebook
    if (sentState.remoteCreated) {
      merged = await wrap(notebookApi.patch(notebookId, requestBody, myAbort.signal))
    } else {
      try {
        merged = await wrap(notebookApi.create(requestBody, myAbort.signal))
      } catch (error) {
        // A 409 on create means the notebook already exists under us: the POST
        // committed server-side but its ack was lost, then an edit made the
        // re-POSTed content differ (backend `_matches_create_payload`). Adopt it
        // as created and re-push as PATCH (which LWW-merges) instead of wedging on
        // a terminal 409 forever — the create-ack/409 family (review C-1/C-2).
        if (error instanceof ApiError && error.status === 409) {
          if (myGeneration !== generation) return
          syncState = {
            ...syncState,
            remoteCreated: true,
            dirty: true,
            ownerId: currentOwnerId() ?? syncState.ownerId,
          }
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
      ownerId: sentState.ownerId ?? currentOwnerId(),
      lastSyncedUpdatedAt: syncState.lastSyncedUpdatedAt,
      // Drop only the tombstones we actually sent; keep any added in flight.
      deletedCells: dropAckedTombstones(syncState.deletedCells, sentTombstoneIds),
      // Preserve an overflow flag — including one raised by delete churn DURING
      // this push (the live `syncState`, not the sent snapshot). Clearing it on the
      // rebuild would let the next push send the capped, incomplete tombstone set
      // instead of failing terminally, silently resurrecting the dropped deletes.
      tombstonesOverflow: sentState.tombstonesOverflow || syncState.tombstonesOverflow,
    }
    await wrap(persistSyncState())

    // INV-3: adopt the merged server doc as the new baseline ONLY when the
    // in-memory notebook is clean and nothing newer committed — otherwise the
    // user's fresher edits would be clobbered.
    let adoptedToServer = false
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
      adoptedToServer = true
      // Note: re-seeding previousCellIds after the adopted reload is handled by the
      // notebookRestoredAtom subscription (restoreNotebook bumps it), which also
      // covers cross-tab reloads and the Reload button (review veai High).
    }
    if (myGeneration !== generation) return

    if (syncState.dirty) {
      setStatus('syncing')
      pushAgain = true
    } else {
      // Synced: record the watermark of the version storage now holds (the adopted
      // server merge, or the doc we pushed) so a crash that loses the dirty flag is
      // still detected on the next boot (C-4).
      const syncedUpdatedAt = adoptedToServer ? merged.updatedAt : stored.updatedAt
      syncState = { ...syncState, lastSyncedUpdatedAt: syncedUpdatedAt }
      await wrap(persistSyncState())
      setStatus('synced')
    }
  } catch (error) {
    if (myGeneration !== generation) return
    // Log every push failure (C-14): the queue is never lost, but a silent
    // terminal 'failed' would make a stuck sync invisible to support.
    console.warn('remoteSync: push failed', error)
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
  } finally {
    // Clear the controller unless a newer push already replaced it.
    if (currentAbort === myAbort) currentAbort = null
  }
}

/** Abort the in-flight push's HTTP request (its result is discarded by `generation`). */
function abortCurrentPush(): void {
  currentAbort?.abort()
  currentAbort = null
}

async function pushNow(): Promise<void> {
  if (pushInFlight) {
    pushAgain = true
    return
  }
  pushInFlight = true
  // Scope the in-flight lock to this engine instance. After teardown/pause aborts
  // an old request and a fresh startRemoteSync begins a newer engine (re-login),
  // the stale old push can still settle here; without this guard its `finally`
  // would clear the NEWER engine's lock, letting a later save start an overlapping
  // POST/PATCH. `startEpoch` bumps only on (re)start, so a pause+resume keeps the
  // same epoch (the lock is still ours), while a restart does not.
  const myEpoch = startEpoch
  try {
    do {
      pushAgain = false
      await wrap(runOnePush())
      // Known follow-up (#135, cosmetic): under continuous typing this loops a new
      // full-document push per server round-trip instead of re-arming the 1500ms
      // debounce for the `newerLocal` case (the 409→PATCH recovery should stay
      // immediate). Bounded and data-safe (opus L7).
    } while (
      pushAgain &&
      myEpoch === startEpoch &&
      !pausedAtom() &&
      isAuthenticated() &&
      isOnlineAtom()
    )
  } finally {
    if (myEpoch === startEpoch) pushInFlight = false
  }
}

function scheduleLoadRetry(notebookId: string): void {
  if (loadRetryTimer !== null) return
  loadRetryTimer = setTimeout(
    wrap(() => {
      loadRetryTimer = null
      void loadStateAndFlush(notebookId)
    }),
    INITIAL_RETRY_MS,
  )
}

async function loadStateAndFlush(notebookId: string): Promise<void> {
  // Bind this load to the engine instance that started it. With the shared
  // LOCAL_NOTEBOOK_ID a teardown+restart keeps `activeNotebookId` the same, so an
  // in-flight getSyncState resolving after a restart would otherwise merge stale
  // durable state into the NEW engine (re-mark dirty, resurrect tombstones, flip
  // remoteCreated, push in the wrong lifecycle). `startEpoch` bumps only on
  // (re)start, so it tells a restart apart from a mere pause.
  const myEpoch = startEpoch
  let loaded: NotebookSyncState | undefined
  try {
    loaded = await wrap(notebookStorage.getSyncState(notebookId))
  } catch (error) {
    if (myEpoch !== startEpoch) return
    // A read FAILURE (not a clean absent record) leaves the durable queue unknown.
    // Do NOT proceed with a fresh provisional state — a later save persisting it
    // would clobber the unread durable dirty/tombstones/remoteCreated/ownerId
    // (review A-1). Retry the load; until it succeeds `metadataLoaded` stays false,
    // so onLocalSaveCommitted holds off persisting and runOnePush holds off pushing.
    console.warn('remoteSync: failed to load sync metadata; will retry', error)
    scheduleLoadRetry(notebookId)
    return
  }
  if (myEpoch !== startEpoch || activeNotebookId !== notebookId) return
  // Merge, don't clobber: a local save during the load window already recorded
  // dirty/tombstones into the provisional state — union them with the loaded
  // record instead of letting a clean record overwrite the change (H-2).
  const provisional = syncState ?? initialSyncState(notebookId)
  const hadProvisionalChanges = provisional.dirty || provisional.deletedCells.length > 0
  syncState = loaded ? mergeSyncState(loaded, provisional) : provisional
  metadataLoaded = true
  // If a save was held off during a prior failed load, persist the merged result now.
  if (hadProvisionalChanges) void persistSyncState()
  // C-4: a previously-synced notebook whose stored doc is newer than the last
  // synced watermark has unsynced content even if the dirty flag was lost to a
  // crash before it persisted — mark it dirty so the change is not stranded.
  //
  // Deliberately scoped to `remoteCreated`: a NEVER-created notebook whose dirty
  // flag was lost to a crash also lost its `ownerId`, so boot-pushing it would risk
  // uploading content under the wrong account (the cross-account leak the owner-gate
  // prevents). That stays a liveness gap only — no data loss, it syncs on the next
  // edit (which re-records ownerId + dirty). Atomic content+marker write → #135.
  if (syncState.remoteCreated && !syncState.dirty) {
    try {
      const stored = await wrap(notebookStorage.get(notebookId))
      if (myEpoch !== startEpoch || activeNotebookId !== notebookId) return
      if (stored && stored.updatedAt > (syncState.lastSyncedUpdatedAt ?? 0)) {
        syncState = { ...syncState, dirty: true }
      }
    } catch {
      // Unreadable / newer-format stored doc — skip boot-detection; the normal
      // edit-driven path still syncs. Never let this reject loadStateAndFlush.
    }
  }
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
    const nextDeletedCells = retractTombstones(withAdded, currentIds)
    const tombstonesOverflow =
      syncState.tombstonesOverflow || nextDeletedCells.length > MAX_DELETED_CELLS
    syncState = {
      ...syncState,
      dirty: true,
      // Stamp the current account so a queue left on a shared device is never
      // pushed under another account (keep a prior owner if signed out now).
      ownerId: currentOwnerId() ?? syncState.ownerId,
      deletedCells: tombstonesOverflow
        ? nextDeletedCells.slice(0, MAX_DELETED_CELLS)
        : nextDeletedCells,
      tombstonesOverflow,
    }
    // A-1: a save made with the token present but the user not hydrated yet gets
    // no ownerId; without this the owner-gate would strand it until the next edit
    // (the userAtom-hydration retry only re-runs pushNow, never re-attributes).
    // Capture the in-flight token so hydration attributes the queue ONLY if the
    // same session is still current. A truly signed-out save (no token) stays
    // unattributed by #136 device-mode design.
    if (syncState.ownerId === undefined && isAuthenticated()) {
      ownerHydrationToken = accessTokenAtom()
    }
    if (syncState.tombstonesOverflow) {
      console.warn(
        `remoteSync: deletedCells buffer over cap (${syncState.deletedCells.length} stored, cap ` +
          `${MAX_DELETED_CELLS}) — push will fail terminally until compaction (#135)`,
      )
    }
    // Hold off persisting until the durable metadata has been read — otherwise this
    // fresh provisional state would clobber an unread durable queue (A-1). The
    // pending load's merge persists the union once it succeeds.
    if (metadataLoaded) void persistSyncState() // self-handles errors + retry
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
  startEpoch += 1
  const myEpoch = startEpoch
  primed = false
  primedRestored = false
  metadataLoaded = false
  pushInFlight = false
  pushAgain = false
  ownerHydrationToken = null
  previousCellIds = new Set(cellsAtom().map((c) => c.id))
  retryDelay = INITIAL_RETRY_MS
  setStatus('idle')

  // Re-seed the delete-detection baseline whenever the notebook is replaced from
  // storage (cross-tab pull, Reload, adoption), so deleting a cell that arrived via
  // a reload still emits a tombstone (review veai High). Skip the first emit.
  unsubscribeRestored = notebookRestoredAtom.subscribe(
    wrap(() => {
      if (!primedRestored) {
        primedRestored = true
        return
      }
      previousCellIds = new Set(cellsAtom().map((c) => c.id))
    }),
  )

  unsubscribeOnline = startOnlineTracking()
  onlineHandler = wrap(() => {
    // On the reconnect edge, attempt a flush. Cancel the pending retry timer but
    // KEEP the backoff (a flapping connection must not reset to the 2s floor every
    // edge). No `isOnlineAtom()` re-check here: runOnePush re-checks it, so this is
    // independent of whether online.ts's listener ran first (review opus L9).
    cancelRetryTimer()
    void pushNow()
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
      } else if (token === null && was !== null) {
        // Sign-out (C-11): abort + discard any in-flight push so a response arriving
        // after logout can't write/adopt and a hung request can't block re-login
        // (B-2). New pushes are already blocked by the isAuthenticated() guard. A
        // pause is NOT used — logout is not a session expiry, and #136 owns wipe.
        console.info('remoteSync: signed out, sync idle')
        generation += 1
        abortCurrentPush()
        // A-1: a pending-attribution queue that has now outlived a sign-out is
        // genuinely ambiguous — never auto-attribute it to whoever signs in next.
        ownerHydrationToken = null
      }
    }),
  )
  // Auth hydration race (A-3 + A-1): the owner-gate needs `userAtom().id`, but the
  // token can hydrate before the user (a restored session whose /auth/me is still
  // in flight, or `setSession` setting the token first). Two cases when identity
  // arrives: (A-3) a durable queue already attributed to this user just needs a
  // re-flush; (A-1) an in-memory save made in the token-present/user-null window
  // got no ownerId and must be attributed now, or the gate strands it until the
  // next edit. For A-1, attribute ONLY if the access token is still the exact one
  // captured at save time — a rotated/replaced token means a different session
  // (possibly a different account), so we leave the save unattributed (it
  // self-heals on the next edit) rather than risk an upload under the wrong user.
  primedUser = false
  unsubscribeUser = userAtom.subscribe(
    wrap(() => {
      if (!primedUser) {
        primedUser = true
        return
      }
      if (userAtom() === null) return
      const ownerNow = currentOwnerId()
      if (
        ownerHydrationToken !== null &&
        ownerHydrationToken === accessTokenAtom() &&
        ownerNow !== undefined &&
        syncState !== null &&
        syncState.ownerId === undefined &&
        !syncState.ownerConflict
      ) {
        ownerHydrationToken = null
        syncState = { ...syncState, ownerId: ownerNow }
        if (metadataLoaded) void persistSyncState()
      }
      void pushNow()
    }),
  )
  // Generation-bound (by start epoch) so a stale handle from a PREVIOUS start
  // (e.g. #135 re-login re-calls startRemoteSync) cannot tear down the current
  // engine. A pause does not bump the epoch, so the legitimate handle still tears
  // down after a pause (C-8).
  return () => {
    if (myEpoch === startEpoch) teardownRemoteSync()
  }
}

/** Clear every lifecycle timer (debounce, metadata-load/persist retry, push retry). */
function cancelAllTimers(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (persistRetryTimer !== null) {
    clearTimeout(persistRetryTimer)
    persistRetryTimer = null
  }
  if (loadRetryTimer !== null) {
    clearTimeout(loadRetryTimer)
    loadRetryTimer = null
  }
  resetRetry()
}

function teardownRemoteSync(): void {
  generation += 1 // discard any in-flight push result
  abortCurrentPush()
  cancelAllTimers()
  unsubscribeSignal?.()
  unsubscribeSignal = null
  unsubscribeRestored?.()
  unsubscribeRestored = null
  unsubscribeToken?.()
  unsubscribeToken = null
  unsubscribeUser?.()
  unsubscribeUser = null
  if (onlineHandler && typeof window !== 'undefined') {
    window.removeEventListener('online', onlineHandler)
  }
  onlineHandler = null
  unsubscribeOnline?.()
  unsubscribeOnline = null
  flushDebouncedPush = null
  activeNotebookId = null
  // Null the per-notebook bookkeeping so it can't linger in module memory between
  // teardown and the next start (start re-seeds it). Hardens #135 re-login /
  // multi-notebook against reading another notebook's state (review opus L6).
  syncState = null
  previousCellIds = new Set()
}

/**
 * Pause syncing on `onSessionExpired` (refresh already failed — a real re-login is
 * needed). Stops pending/in-flight pushes WITHOUT wiping local data: the queue
 * persists and flushes after the next sign-in. The engine never decides this from
 * a 401 itself — only this explicit signal pauses it.
 */
export function pauseRemoteSync(): void {
  console.info('remoteSync: paused (session expired) — re-login required')
  pausedAtom.set(true)
  generation += 1
  abortCurrentPush()
  cancelAllTimers()
  setStatus('paused')
}
