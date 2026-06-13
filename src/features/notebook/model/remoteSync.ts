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
//
// Lifecycle ownership — one engine instance per `startRemoteSync` (C-1 decomposition):
//   All per-run state lives on a `RemoteSyncEngine` instance, and `active` points at
//   the current one. A re-init (re-login / #135 slot switch) tears down the prior
//   instance and creates a fresh one. Because every async continuation closes over
//   ITS instance, a stale request/load/timer that settles after a restart mutates
//   only its own (dead) instance — it can never touch the live engine's state. Two
//   guards remain: the per-instance `generation` (bumped on pause/teardown/sign-out)
//   discards an in-flight result within the same instance, and `active === this`
//   tells a continuation whether its instance is still the live one. Each push gets
//   an AbortController threaded through the facade so pause/teardown/sign-out abort
//   the in-flight HTTP request too.

import { atom, wrap } from '@reatom/core'
import { ApiError, NetworkError, notebook as notebookApi, RateLimitedError } from '@/shared/api'
import { accessTokenAtom, userAtom } from '@/entities/session'
import { notebookStorage } from '../persistence/activeStorage'
import { NewerFormatError } from '../persistence/migrations'
import { isNotebookJSON, type NotebookJSON } from '../persistence/schema'
import type { NotebookSyncState } from '../persistence/storageAdapter'
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
// Hard cap on the tombstone buffer (review veai B-4 / gpt B-2): heavy offline
// add/delete churn can grow it without bound. Over this, the push fails terminally
// (preflight) instead of sending a pathological body; a real compaction /
// full-replace protocol is a #135 follow-up.
const MAX_DELETED_CELLS = 1000

/** Coarse status for the UI (#135 surfaces it; the engine only needs internal state). */
export const remoteSyncStatusAtom = atom<RemoteSyncStatus>('idle', 'notebook.remoteSync.status')
/** True after `onSessionExpired` — pushes are paused until a fresh sign-in. */
export const pausedAtom = atom(false, 'notebook.remoteSync.paused')

// ---------------------------------------------------------------------------
// Stateless helpers (no per-run lifecycle state — shared by every engine instance)
// ---------------------------------------------------------------------------

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
 *
 * Stateless w.r.t. the engine instance: it only touches params, atoms, and storage,
 * so it stays a module helper (the caller re-checks `generation` after awaiting it).
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

// ---------------------------------------------------------------------------
// The engine instance — owns all per-run lifecycle state
// ---------------------------------------------------------------------------

class RemoteSyncEngine {
  private readonly notebookId: string
  // The locally-staged sync queue (dirty flag + tombstones + owner). Provisional
  // until the durable metadata load resolves.
  private syncState: NotebookSyncState | null
  // Cell ids at the last commit, to diff for deletions (→ tombstones).
  private previousCellIds: Set<string>

  // First-emit skip flags for the four subscriptions (Reatom fires once on subscribe).
  private primed = false
  private primedRestored = false
  private primedToken = false
  private primedUser = false
  private previousToken: string | null = null
  // A-1 / v13: the access token captured when a save was made in the
  // token-present / user-null window. The userAtom-hydration handler attributes the
  // queue only if this token is still current. A same-session token ROTATION
  // (refreshMiddleware) re-binds it to the new token (see the token subscription),
  // so a refresh that lands before /auth/me finishes does not strand the queue. An
  // account switch always goes through a null token first (the sign-out branch
  // clears this), so the pending attribution never crosses accounts. `null` when
  // nothing is awaiting attribution.
  private ownerHydrationToken: string | null = null

  // False until the durable sync metadata has been read (or confirmed absent). While
  // false, nothing persists or pushes — a read FAILURE leaves the durable queue
  // unknown, and writing a fresh provisional state would clobber it (review A-1).
  private metadataLoaded = false
  private pushInFlight = false
  private pushAgain = false
  // Aborts the in-flight push's HTTP request on pause / teardown / sign-out, so a
  // hung request can't keep `pushInFlight` true and block all later sync (review B-2).
  private currentAbort: AbortController | null = null
  // Bumped on pause/teardown/sign-out; an in-flight push compares it after every
  // await and discards its result if it changed (intra-instance cancellation guard).
  private generation = 0

  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private persistRetryTimer: ReturnType<typeof setTimeout> | null = null
  private loadRetryTimer: ReturnType<typeof setTimeout> | null = null
  private retryDelay = INITIAL_RETRY_MS
  private retryDueAt = 0 // Date.now()+delay of the pending retry, so a later 429 can extend it

  private unsubscribeSignal: (() => void) | null = null
  private unsubscribeRestored: (() => void) | null = null
  private unsubscribeToken: (() => void) | null = null
  private unsubscribeUser: (() => void) | null = null
  private unsubscribeOnline: (() => void) | null = null
  private onlineHandler: (() => void) | null = null
  private flushDebouncedPush: (() => void) | null = null

  constructor(notebookId: string) {
    this.notebookId = notebookId
    this.syncState = initialSyncState(notebookId) // provisional until the load resolves
    this.previousCellIds = new Set(cellsAtom().map((c) => c.id))
  }

  /** True while this instance is the live engine (not superseded by a restart / torn down). */
  private isActive(): boolean {
    return active === this
  }

  private armDebounce(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => this.flushDebouncedPush?.(), REMOTE_DEBOUNCE_MS)
  }

  /** Cancel a pending retry timer WITHOUT resetting the backoff delay. */
  private cancelRetryTimer(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.retryDueAt = 0
  }

  /** Cancel a pending retry AND reset the backoff — only on a successful push / fresh session. */
  private resetRetry(): void {
    this.cancelRetryTimer()
    this.retryDelay = INITIAL_RETRY_MS
  }

  /**
   * Arm a single delayed retry with exponential backoff (capped). `delayOverride`
   * (ms) honours a server `Retry-After`. The backoff grows per scheduled retry and
   * is reset only by a successful push — NOT on every `online` edge — so a flapping
   * connection can't hammer a throttling server.
   */
  private scheduleRetry(delayOverride?: number): void {
    // Known follow-up (#135, low priority): a retry timer that fires while offline
    // re-arms here and grows the backoff with no server contact (opus L3).
    const delay = Math.max(delayOverride ?? 0, this.retryDelay)
    const dueAt = Date.now() + delay
    if (this.retryTimer !== null) {
      // One pending retry, but a later server-requested delay (a larger 429
      // Retry-After) extends it rather than being dropped (review opus L4 / gpt).
      if (dueAt <= this.retryDueAt) return
      clearTimeout(this.retryTimer)
    }
    this.retryDueAt = dueAt
    this.retryTimer = setTimeout(
      wrap(() => {
        this.retryTimer = null
        void this.pushNow()
      }),
      delay,
    )
    this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_MS)
  }

  /**
   * Write the in-memory sync-state through to the active backend's sync partition.
   * Never rejects: a failed write (quota / blocked DB) is logged and a retry is
   * scheduled, so the dirty flag + tombstone queue is not silently lost before the
   * next push (queue durability — review A-4).
   */
  private async persistSyncState(): Promise<void> {
    if (!this.syncState) return
    const myGeneration = this.generation
    try {
      await wrap(notebookStorage.putSyncState(this.syncState))
    } catch (error) {
      // Don't reschedule for a torn-down / paused engine — a stale write-after-clear
      // must not be resurrected (matters once #136 wires clearLocalNotebookData to
      // sign-out; C-7).
      if (myGeneration !== this.generation) return
      console.error('remoteSync: failed to persist sync metadata; scheduling a retry', error)
      if (this.persistRetryTimer === null) {
        this.persistRetryTimer = setTimeout(
          wrap(() => {
            this.persistRetryTimer = null
            void this.persistSyncState()
          }),
          PERSIST_RETRY_MS,
        )
      }
    }
  }

  private async runOnePush(): Promise<void> {
    const notebookId = this.notebookId
    if (this.syncState === null) return
    // Hold off until the durable metadata is loaded — pushing the provisional state
    // (without the real remoteCreated / ownerId / tombstones) would be wrong; the
    // pending load retry flushes once it succeeds (A-1).
    if (!this.metadataLoaded) return
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
    if (this.syncState.ownerConflict) {
      console.warn('remoteSync: local notebook has an unresolved owner conflict; not pushing')
      setStatus('failed')
      return
    }
    const owner = currentOwnerId()
    if (owner === undefined || this.syncState.ownerId !== owner) {
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
    if (!this.syncState.dirty && this.syncState.deletedCells.length === 0) {
      setStatus('synced')
      return
    }

    // Capture the generation BEFORE the first await, so a teardown/pause during the
    // storage read is detected and we never issue HTTP for a dead engine.
    const myGeneration = this.generation
    // Local-first: push exactly what local storage holds (INV-2: full doc incl. cells).
    // The read is in its own try so a storage failure doesn't escape as an unhandled
    // rejection with no status/retry (review veai High).
    let stored: NotebookJSON | undefined
    try {
      stored = await wrap(notebookStorage.get(notebookId))
    } catch (error) {
      if (myGeneration !== this.generation) return
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
      this.scheduleRetry()
      return
    }
    if (myGeneration !== this.generation) return
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
              this.syncState.tombstonesOverflow ||
                this.syncState.deletedCells.length > MAX_DELETED_CELLS
              ? `${this.syncState.deletedCells.length} tombstones (> ${MAX_DELETED_CELLS})`
              : null
    if (overLimit !== null) {
      console.warn(`remoteSync: payload exceeds a backend limit (${overLimit}); not pushing`)
      setStatus('failed')
      return
    }

    const sentSeq = localSaveCommittedAtom()
    const sentState = this.syncState
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
    this.currentAbort = myAbort
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
            if (myGeneration !== this.generation) return
            this.syncState = {
              ...this.syncState,
              remoteCreated: true,
              dirty: true,
              ownerId: currentOwnerId() ?? this.syncState.ownerId,
            }
            await wrap(this.persistSyncState())
            this.pushAgain = true
            return
          }
          throw error
        }
      }

      // Discard the result if the engine was torn down / paused during the await.
      if (myGeneration !== this.generation) return

      this.resetRetry()
      // A local save that committed while the request was in flight keeps us dirty
      // and means the merged response is stale (don't apply it; re-push instead).
      const newerLocal = localSaveCommittedAtom() !== sentSeq
      this.syncState = {
        notebookId,
        remoteCreated: true,
        dirty: newerLocal,
        ownerId: sentState.ownerId ?? currentOwnerId(),
        lastSyncedUpdatedAt: this.syncState.lastSyncedUpdatedAt,
        // Drop only the tombstones we actually sent; keep any added in flight.
        deletedCells: dropAckedTombstones(this.syncState.deletedCells, sentTombstoneIds),
        // Preserve an overflow flag — including one raised by delete churn DURING
        // this push (the live state, not the sent snapshot). Clearing it on the
        // rebuild would let the next push send the capped, incomplete tombstone set
        // instead of failing terminally, silently resurrecting the dropped deletes.
        tombstonesOverflow: sentState.tombstonesOverflow || this.syncState.tombstonesOverflow,
      }
      await wrap(this.persistSyncState())

      // INV-3: adopt the merged server doc as the new baseline ONLY when the
      // in-memory notebook is clean and nothing newer committed — otherwise the
      // user's fresher edits would be clobbered.
      let adoptedToServer = false
      if (!hasLocalChangesAtom() && !newerLocal) {
        const result = await wrap(
          applyServerBaseline(notebookId, merged, stored.updatedAt, stored.cells.length > 0),
        )
        if (myGeneration !== this.generation) return
        if (result !== 'applied') {
          // Keep local authoritative and stay dirty so the change reconverges.
          this.syncState = { ...this.syncState, dirty: true }
          await wrap(this.persistSyncState())
          if (result === 'deferred') {
            // Transient (concurrent edit / newer storage) — re-push after a delay.
            setStatus('syncing')
            this.scheduleRetry()
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
      if (myGeneration !== this.generation) return

      if (this.syncState.dirty) {
        // Re-arm the remote debounce rather than looping immediately (review
        // gpt-v-12): an ordinary follow-up (a save committed while this push was in
        // flight) coalesces with continued typing into ONE delayed push, instead of
        // a full-document upload per server round-trip. The change is already
        // persisted dirty above, so nothing is lost if the timer is later cancelled
        // (the next load re-detects it). Protocol recovery (POST-409 → PATCH) stays
        // immediate via its own `pushAgain`.
        setStatus('syncing')
        this.armDebounce()
      } else {
        // Synced: record the watermark of the version storage now holds (the adopted
        // server merge, or the doc we pushed) so a crash that loses the dirty flag is
        // still detected on the next boot (C-4).
        const syncedUpdatedAt = adoptedToServer ? merged.updatedAt : stored.updatedAt
        this.syncState = { ...this.syncState, lastSyncedUpdatedAt: syncedUpdatedAt }
        await wrap(this.persistSyncState())
        setStatus('synced')
      }
    } catch (error) {
      if (myGeneration !== this.generation) return
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
        this.scheduleRetry(retryAfterMs(error))
      } else {
        // A permanent 4xx (400/403/404/409/422): the server rejects this body every
        // time, so do NOT loop forever (which would also hide a real bug behind a
        // false 'synced'). Keep the queue and surface a terminal status. A shared-id
        // 403 lands here — see docs/architecture/remote-sync.md "per-owner id".
        setStatus('failed')
      }
    } finally {
      // Clear the controller unless a newer push already replaced it.
      if (this.currentAbort === myAbort) this.currentAbort = null
    }
  }

  /** Abort the in-flight push's HTTP request (its result is discarded by `generation`). */
  private abortCurrentPush(): void {
    this.currentAbort?.abort()
    this.currentAbort = null
  }

  private async pushNow(): Promise<void> {
    if (this.pushInFlight) {
      this.pushAgain = true
      return
    }
    this.pushInFlight = true
    // The in-flight lock is per-instance: a stale push from a torn-down engine
    // clears only its own (dead) flag, never the live engine's — overlapping
    // POST/PATCH under session churn is structurally impossible (was the v10
    // module-level-lock hazard). The loop still stops if this instance is
    // superseded mid-loop (`isActive`) or paused/signed-out/offline.
    try {
      do {
        this.pushAgain = false
        await wrap(this.runOnePush())
        // The loop now only re-iterates for protocol recovery that sets `pushAgain`
        // (POST-409 → PATCH), which must stay immediate. An ordinary follow-up after a
        // save committed in flight re-arms the 1500ms debounce instead (see runOnePush),
        // so continuous typing coalesces into one delayed push (review gpt-v-12).
      } while (
        this.pushAgain &&
        this.isActive() &&
        !pausedAtom() &&
        isAuthenticated() &&
        isOnlineAtom()
      )
    } finally {
      this.pushInFlight = false
    }
  }

  private scheduleLoadRetry(): void {
    if (this.loadRetryTimer !== null) return
    this.loadRetryTimer = setTimeout(
      wrap(() => {
        this.loadRetryTimer = null
        void this.loadStateAndFlush()
      }),
      INITIAL_RETRY_MS,
    )
  }

  private async loadStateAndFlush(): Promise<void> {
    const notebookId = this.notebookId
    let loaded: NotebookSyncState | undefined
    try {
      loaded = await wrap(notebookStorage.getSyncState(notebookId))
    } catch (error) {
      // Superseded by a restart while the read was in flight — drop it (the new
      // engine runs its own load). Per-instance state means this can't corrupt the
      // live engine, but bailing avoids a pointless retry on a dead instance.
      if (!this.isActive()) return
      // A read FAILURE (not a clean absent record) leaves the durable queue unknown.
      // Do NOT proceed with a fresh provisional state — a later save persisting it
      // would clobber the unread durable dirty/tombstones/remoteCreated/ownerId
      // (review A-1). Retry the load; until it succeeds `metadataLoaded` stays false,
      // so onLocalSaveCommitted holds off persisting and runOnePush holds off pushing.
      console.warn('remoteSync: failed to load sync metadata; will retry', error)
      this.scheduleLoadRetry()
      return
    }
    // Discard a stale load that resolved after a same-id restart: with the shared
    // LOCAL_NOTEBOOK_ID the new engine targets the same id, so identity (not the id)
    // is what tells them apart. Merging here would re-mark dirty / resurrect
    // tombstones / flip remoteCreated on the wrong instance (review gpt-v-11).
    if (!this.isActive()) return
    // Merge, don't clobber: a local save during the load window already recorded
    // dirty/tombstones into the provisional state — union them with the loaded
    // record instead of letting a clean record overwrite the change (H-2).
    const provisional = this.syncState ?? initialSyncState(notebookId)
    const hadProvisionalChanges = provisional.dirty || provisional.deletedCells.length > 0
    this.syncState = loaded ? mergeSyncState(loaded, provisional) : provisional
    this.metadataLoaded = true
    // If a save was held off during a prior failed load, persist the merged result now.
    if (hadProvisionalChanges) void this.persistSyncState()
    // C-4: a previously-synced notebook whose stored doc is newer than the last
    // synced watermark has unsynced content even if the dirty flag was lost to a
    // crash before it persisted — mark it dirty so the change is not stranded.
    //
    // Deliberately scoped to `remoteCreated`: a NEVER-created notebook whose dirty
    // flag was lost to a crash also lost its `ownerId`, so boot-pushing it would risk
    // uploading content under the wrong account (the cross-account leak the owner-gate
    // prevents). That stays a liveness gap only — no data loss, it syncs on the next
    // edit (which re-records ownerId + dirty). Atomic content+marker write → #135.
    if (this.syncState.remoteCreated && !this.syncState.dirty) {
      try {
        const stored = await wrap(notebookStorage.get(notebookId))
        if (!this.isActive()) return
        if (stored && stored.updatedAt > (this.syncState.lastSyncedUpdatedAt ?? 0)) {
          this.syncState = { ...this.syncState, dirty: true }
        }
      } catch {
        // Unreadable / newer-format stored doc — skip boot-detection; the normal
        // edit-driven path still syncs. Never let this reject loadStateAndFlush.
      }
    }
    if (this.syncState.dirty || this.syncState.deletedCells.length > 0) void this.pushNow()
  }

  private onLocalSaveCommitted(): void {
    if (!this.primed) {
      // Skip the synchronous first emit on subscribe — nothing changed yet.
      this.primed = true
      return
    }
    const currentIds = cellsAtom().map((c) => c.id)
    const removed = removedCellIds(this.previousCellIds, currentIds)
    this.previousCellIds = new Set(currentIds)
    if (this.syncState) {
      // Add tombstones for cells deleted since the last commit, and retract any
      // whose id is present again (delete→undo restores the same id) — otherwise
      // the next PATCH would carry the cell AND a tombstone for it.
      const withAdded = addTombstones(this.syncState.deletedCells, removed, Date.now())
      const nextDeletedCells = retractTombstones(withAdded, currentIds)
      const tombstonesOverflow =
        this.syncState.tombstonesOverflow || nextDeletedCells.length > MAX_DELETED_CELLS
      // A concrete owner is sticky (review gpt-v-12): a DIFFERENT signed-in user
      // editing a notebook already attributed to someone else is an owner conflict
      // (Bob edits Alice's loaded notebook on a shared device), NOT a re-attribution
      // — the `?? prior` fallback alone would overwrite Alice's ownerId with Bob and
      // make her content eligible to upload under his account. Flag the conflict and
      // refuse autosync under either until #136 resolves ownership; this mirrors
      // mergeSyncState's load-race rule for the post-load edit path. Otherwise stamp
      // the current account, keeping a prior owner when signed out.
      const prevOwner = this.syncState.ownerId
      const nowOwner = currentOwnerId()
      const ownerConflict =
        this.syncState.ownerConflict ||
        (prevOwner !== undefined && nowOwner !== undefined && prevOwner !== nowOwner)
      this.syncState = {
        ...this.syncState,
        dirty: true,
        ownerId: ownerConflict ? prevOwner : (nowOwner ?? prevOwner),
        ownerConflict,
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
      if (this.syncState.ownerId === undefined && isAuthenticated()) {
        this.ownerHydrationToken = accessTokenAtom()
      }
      if (this.syncState.tombstonesOverflow) {
        console.warn(
          `remoteSync: deletedCells buffer over cap (${this.syncState.deletedCells.length} stored, cap ` +
            `${MAX_DELETED_CELLS}) — push will fail terminally until compaction (#135)`,
        )
      }
      // Hold off persisting until the durable metadata has been read — otherwise this
      // fresh provisional state would clobber an unread durable queue (A-1). The
      // pending load's merge persists the union once it succeeds.
      if (this.metadataLoaded) void this.persistSyncState() // self-handles errors + retry
    }
    this.armDebounce()
  }

  /** Wire the subscriptions, window listeners and kick the durable-metadata load. */
  start(): void {
    pausedAtom.set(false)
    setStatus('idle')

    // Re-seed the delete-detection baseline whenever the notebook is replaced from
    // storage (cross-tab pull, Reload, adoption), so deleting a cell that arrived via
    // a reload still emits a tombstone (review veai High). Skip the first emit.
    this.unsubscribeRestored = notebookRestoredAtom.subscribe(
      wrap(() => {
        if (!this.primedRestored) {
          this.primedRestored = true
          return
        }
        this.previousCellIds = new Set(cellsAtom().map((c) => c.id))
      }),
    )

    this.unsubscribeOnline = startOnlineTracking()
    this.onlineHandler = wrap(() => {
      // On the reconnect edge, attempt a flush. Cancel the pending retry timer but
      // KEEP the backoff (a flapping connection must not reset to the 2s floor every
      // edge). No `isOnlineAtom()` re-check here: runOnePush re-checks it, so this is
      // independent of whether online.ts's listener ran first (review opus L9).
      this.cancelRetryTimer()
      void this.pushNow()
    })
    if (typeof window !== 'undefined') window.addEventListener('online', this.onlineHandler)

    this.flushDebouncedPush = wrap(() => {
      this.debounceTimer = null
      void this.pushNow()
    })

    void wrap(this.loadStateAndFlush())

    this.unsubscribeSignal = localSaveCommittedAtom.subscribe(
      wrap(() => this.onLocalSaveCommitted()),
    )
    // Resume + flush on a fresh sign-in: a change queued while signed out (the
    // engine stayed idle on the `!isAuthenticated` guard) is sent once a token
    // appears, and a paused engine resumes. Only a null→token transition triggers
    // it (a token→null sign-out does not push).
    this.unsubscribeToken = accessTokenAtom.subscribe(
      wrap(() => {
        const token = accessTokenAtom()
        const was = this.previousToken
        this.previousToken = token
        if (!this.primedToken) {
          this.primedToken = true
          return
        }
        if (token !== null && was === null) {
          pausedAtom.set(false)
          this.resetRetry()
          void this.pushNow()
        } else if (token === null && was !== null) {
          // Sign-out (C-11): abort + discard any in-flight push so a response arriving
          // after logout can't write/adopt and a hung request can't block re-login
          // (B-2). New pushes are already blocked by the isAuthenticated() guard. A
          // pause is NOT used — logout is not a session expiry, and #136 owns wipe.
          console.info('remoteSync: signed out, sync idle')
          this.generation += 1
          this.abortCurrentPush()
          // A-1: a pending-attribution queue that has now outlived a sign-out is
          // genuinely ambiguous — never auto-attribute it to whoever signs in next.
          this.ownerHydrationToken = null
        } else if (token !== null && was !== null && token !== was) {
          // Token rotation within one session (refreshMiddleware rotated the access
          // token): re-bind a pending attribution from the old token to the new one
          // so it survives the rotation (review gpt-v-13). A different account always
          // arrives via a null boundary (handled above, which clears the pending
          // token), so this only ever re-binds within the SAME session — it never
          // attributes a save across accounts.
          if (this.ownerHydrationToken === was) this.ownerHydrationToken = token
        }
      }),
    )
    // Auth hydration race (A-3 + A-1): the owner-gate needs `userAtom().id`, but the
    // token can hydrate before the user (a restored session whose /auth/me is still
    // in flight, or `setSession` setting the token first). Two cases when identity
    // arrives: (A-3) a durable queue already attributed to this user just needs a
    // re-flush; (A-1) an in-memory save made in the token-present/user-null window
    // got no ownerId and must be attributed now, or the gate strands it until the
    // next edit. For A-1, attribute ONLY if the access token is still the one bound
    // to the pending save. A same-session rotation re-binds that token (token
    // subscription), so this stays current through a refresh; a cross-account switch
    // goes through a null token first and clears it, so attribution never crosses
    // accounts.
    this.unsubscribeUser = userAtom.subscribe(
      wrap(() => {
        if (!this.primedUser) {
          this.primedUser = true
          return
        }
        if (userAtom() === null) return
        const ownerNow = currentOwnerId()
        if (
          this.ownerHydrationToken !== null &&
          this.ownerHydrationToken === accessTokenAtom() &&
          ownerNow !== undefined &&
          this.syncState !== null &&
          this.syncState.ownerId === undefined &&
          !this.syncState.ownerConflict
        ) {
          this.ownerHydrationToken = null
          this.syncState = { ...this.syncState, ownerId: ownerNow }
          if (this.metadataLoaded) void this.persistSyncState()
        }
        void this.pushNow()
      }),
    )
  }

  /** Clear every lifecycle timer (debounce, metadata-load/persist retry, push retry). */
  private cancelAllTimers(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.persistRetryTimer !== null) {
      clearTimeout(this.persistRetryTimer)
      this.persistRetryTimer = null
    }
    if (this.loadRetryTimer !== null) {
      clearTimeout(this.loadRetryTimer)
      this.loadRetryTimer = null
    }
    this.resetRetry()
  }

  /** Drop all listeners/subscriptions/timers and discard any in-flight push result. */
  teardown(): void {
    this.generation += 1 // discard any in-flight push result
    this.abortCurrentPush()
    this.cancelAllTimers()
    this.unsubscribeSignal?.()
    this.unsubscribeSignal = null
    this.unsubscribeRestored?.()
    this.unsubscribeRestored = null
    this.unsubscribeToken?.()
    this.unsubscribeToken = null
    this.unsubscribeUser?.()
    this.unsubscribeUser = null
    if (this.onlineHandler && typeof window !== 'undefined') {
      window.removeEventListener('online', this.onlineHandler)
    }
    this.onlineHandler = null
    this.unsubscribeOnline?.()
    this.unsubscribeOnline = null
    this.flushDebouncedPush = null
    // Null the per-notebook bookkeeping so a late continuation that still holds this
    // instance reads nothing stale (the live engine has its own state object anyway).
    this.syncState = null
    this.previousCellIds = new Set()
  }

  /**
   * Pause: stop pending/in-flight pushes WITHOUT tearing the engine down or wiping
   * local data, so a later sign-in resumes from the persisted queue. Bumps the
   * generation (discards an in-flight result) and aborts the request.
   */
  pause(): void {
    this.generation += 1
    this.abortCurrentPush()
    this.cancelAllTimers()
  }
}

// ---------------------------------------------------------------------------
// Public surface — routes to the single live engine instance
// ---------------------------------------------------------------------------

let active: RemoteSyncEngine | null = null

/**
 * Start the background sync for `notebookId` for the app's lifetime. Idempotent
 * re-init: a fresh call (e.g. after re-login) tears down the prior instance, resets
 * pause and re-flushes the queue. Returns an unsubscribe. The engine self-guards on
 * auth, so it is safe to start while signed out — it stays idle and flushes once a
 * token exists.
 */
export function startRemoteSync(notebookId: string): () => void {
  // Idempotent re-init (H-3): drop any prior engine's listeners/subscription/timers
  // before re-wiring, so a repeated start (e.g. #135's re-login) does not leak a
  // second save subscription or duplicate window listeners.
  active?.teardown()
  const engine = new RemoteSyncEngine(notebookId)
  active = engine
  engine.start()
  // The handle tears down ONLY if this instance is still the live one, so a stale
  // handle from a PREVIOUS start (e.g. #135 re-login re-calls startRemoteSync) cannot
  // tear down the current engine. A pause does not replace `active`, so the
  // legitimate handle still tears down after a pause (C-8).
  return () => {
    if (active === engine) {
      engine.teardown()
      active = null
    }
  }
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
  active?.pause()
  setStatus('paused')
}
