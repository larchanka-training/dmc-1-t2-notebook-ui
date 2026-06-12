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
  /** Remove every notebook held by this backend. */
  clearAll(): Promise<void>
}
