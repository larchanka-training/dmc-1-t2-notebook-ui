// The storage contract shared by every notebook persistence backend.
//
// One interface, two implementations: `indexedDbAdapter` (on-disk, the default)
// and `createMemoryAdapter()` (in-memory, for the future untrusted-device mode).
// Autosave and boot-time load talk to the active backend through this contract
// (via `activeStorage`), never to a concrete backend — so #136 can swap disk for
// memory without touching the autosave/load logic.
//
// Method names follow the issue's contract (`delete` / `clearAll`); the value
// type for reads/writes is the existing persisted `NotebookJSON`, so no shape
// change ripples through the codebase. The conflict contract — `PutResult` and
// the `isStaleWrite` rule — lives here, in the abstraction, so both backends
// import it from the contract (impl → contract) rather than the contract
// reaching into a concrete backend.

import type { NotebookJSON } from './schema'

/** Outcome of a conditional write. */
export type PutResult =
  | { ok: true }
  /** Another writer got there first; `current` is the newer stored version. */
  | { ok: false; current: NotebookJSON }

/**
 * The shared `putIfNewer` conflict rule, owned by the contract so every backend
 * decides staleness identically (the divergence the adapter layer exists to
 * prevent). Returns `true` when a write carrying baseline `base` must be
 * rejected because the stored version is newer: a `null` baseline means "no
 * known baseline yet" — write only into an empty slot, so any existing record
 * makes the write stale; otherwise the write is stale when `storedUpdatedAt` is
 * strictly greater than `base`. Callers pair it with a presence check
 * (`existing && isStaleWrite(existing.updatedAt, base)`), which also narrows
 * `existing` for the `current` field.
 *
 * Precondition: `storedUpdatedAt` is a finite number (guaranteed by schema
 * validation + atom typing at every call site). A `NaN` would make every
 * comparison `false`, i.e. silently treat the write as fresh.
 */
export function isStaleWrite(storedUpdatedAt: number, base: number | null): boolean {
  return base === null || storedUpdatedAt > base
}

// ---------------------------------------------------------------------------
// Sync-metadata partition (#134)
// ---------------------------------------------------------------------------
//
// The remote autosync layer keeps per-notebook bookkeeping — an unsynced-change
// flag and the `deletedCells` tombstone buffer — in a SEPARATE named partition of
// the SAME active backend, never a parallel IndexedDB. Routing it through this
// contract means the storage mode follows the trusted/untrusted device choice
// (#136) and `clearAll()` wipes it together with the notebooks, so
// `clearLocalNotebookData()` leaves nothing behind in one call.

/** A deleted-cell marker (tombstone): persisted in the queue, sent on PATCH. */
export interface CellTombstoneJSON {
  /** The deleted cell's id (UUID; matches the backend `CellTombstone.id`). */
  id: string
  /** Deletion time, Unix epoch ms (`CellTombstone.deletedAt`). */
  deletedAt: number
}

/** Per-notebook sync state, stored in the sync-metadata partition. */
export interface NotebookSyncState {
  /** Owning notebook id (the partition key). */
  notebookId: string
  /** True once the notebook exists server-side (the first POST succeeded). */
  remoteCreated: boolean
  /** True when the locally-persisted doc has changes not yet acked by the server. */
  dirty: boolean
  /**
   * Id of the account that owns this queued state (`userAtom().id` when the dirty
   * change was recorded). The engine refuses to push a queue whose `ownerId` does
   * not match the current user — so a queue left by one account on a shared device
   * is never uploaded under another account's token (cross-account safety). Absent
   * on records written before this field existed and on changes made while signed
   * out (which cannot be attributed).
   */
  ownerId?: string
  /**
   * Set when two different concrete accounts have contested the shared local
   * notebook (a load-race on a shared device): the engine refuses to auto-push such
   * a queue under either account. Cleared only by the #136 device-mode resolution.
   */
  ownerConflict?: boolean
  /** Tombstones for cells deleted locally, not yet acked by the server's merge. */
  deletedCells: CellTombstoneJSON[]
  /**
   * `updatedAt` of the local doc at the last successful sync. Boot compares the
   * stored doc against this to detect content newer than what was synced even when
   * the `dirty` flag was lost to a crash before it persisted (review C-4). Absent
   * until the first successful sync.
   */
  lastSyncedUpdatedAt?: number
}

// Tombstone ids are RFC 4122 UUIDs (backend `CellTombstone.id` is `format: uuid`),
// matching the cell-id contract in `schema.ts`. Validating the shape here keeps a
// non-UUID id or a negative timestamp out of a PATCH body (which the backend would
// reject with a deterministic 422, wedging the queue).
const TOMBSTONE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_DELETED_CELLS = 1000

function isSyncObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCellTombstoneJSON(value: unknown): value is CellTombstoneJSON {
  return (
    isSyncObject(value) &&
    typeof value['id'] === 'string' &&
    TOMBSTONE_UUID_RE.test(value['id']) &&
    typeof value['deletedAt'] === 'number' &&
    Number.isFinite(value['deletedAt']) &&
    value['deletedAt'] >= 0
  )
}

/**
 * Boundary validator for a stored sync-state record (AGENTS §11 — a read from
 * storage is untrusted). A record that fails this is treated as absent by the
 * backend (the engine re-initialises it), never thrown: sync bookkeeping must not
 * be able to crash boot or autosave.
 */
export function isNotebookSyncState(value: unknown): value is NotebookSyncState {
  return (
    isSyncObject(value) &&
    typeof value['notebookId'] === 'string' &&
    typeof value['remoteCreated'] === 'boolean' &&
    typeof value['dirty'] === 'boolean' &&
    (value['ownerId'] === undefined || typeof value['ownerId'] === 'string') &&
    (value['ownerConflict'] === undefined || typeof value['ownerConflict'] === 'boolean') &&
    Array.isArray(value['deletedCells']) &&
    value['deletedCells'].length <= MAX_DELETED_CELLS &&
    value['deletedCells'].every(isCellTombstoneJSON) &&
    (value['lastSyncedUpdatedAt'] === undefined ||
      (typeof value['lastSyncedUpdatedAt'] === 'number' &&
        Number.isFinite(value['lastSyncedUpdatedAt'])))
  )
}

export interface NotebookStorageAdapter {
  /**
   * Read one notebook by id, migrated + validated. `undefined` if absent.
   *
   * @throws NewerFormatError on the disk backend if the stored record is from a
   * newer app version (never downgrade it). The memory backend cannot produce
   * this — it only holds in-session current-format notebooks.
   */
  get(id: string): Promise<NotebookJSON | undefined>
  /** Insert or replace a notebook unconditionally (last-write-wins). */
  put(notebook: NotebookJSON): Promise<void>
  /**
   * Compare-and-swap write: persist `notebook` only if no newer version exists
   * since the caller's `base` timestamp. Returns `{ ok: false, current }` when a
   * newer record is already stored, so the caller can resolve the conflict.
   *
   * @throws NewerFormatError on the disk backend if the stored record is from a
   * newer app version (memory backend never throws this — see `get`).
   */
  putIfNewer(notebook: NotebookJSON, base: number | null): Promise<PutResult>
  /** Delete a notebook by id. No-op if it does not exist. */
  delete(id: string): Promise<void>
  /**
   * All notebooks, most recently edited first (ties broken by id descending).
   * Does not throw on a single unreadable/newer-format record — the disk backend
   * skips it and lists the rest.
   */
  list(): Promise<NotebookJSON[]>
  /** Remove every notebook AND every sync-state record held by this backend. */
  clearAll(): Promise<void>
  /** Read one notebook's sync state, validated. `undefined` if absent or invalid. */
  getSyncState(notebookId: string): Promise<NotebookSyncState | undefined>
  /** Insert or replace one notebook's sync state (keyed by `state.notebookId`). */
  putSyncState(state: NotebookSyncState): Promise<void>
  /** Delete one notebook's sync state. No-op if it does not exist. */
  deleteSyncState(notebookId: string): Promise<void>
}
