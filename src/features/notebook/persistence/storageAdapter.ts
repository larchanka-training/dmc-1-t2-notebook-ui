// The storage contract shared by every notebook persistence backend.
//
// One interface, two implementations: `indexedDbAdapter` (on-disk, the default)
// and `createMemoryAdapter()` (in-memory, for the future untrusted-device mode).
// Autosave and boot-time load talk to the active backend through this contract
// (via `activeStorage`), never to a concrete backend — so #136 can swap disk for
// memory without touching the autosave/load logic.
//
// Method names follow the issue's contract (`delete` / `clearAll`); the value
// types are the existing persisted ones (`NotebookJSON`, `PutResult`), so no
// shape change ripples through the codebase.

import type { NotebookJSON } from './schema'
import type { PutResult } from './storage'

export interface NotebookStorageAdapter {
  /** Read one notebook by id, migrated + validated. `undefined` if absent. */
  get(id: string): Promise<NotebookJSON | undefined>
  /** Insert or replace a notebook unconditionally (last-write-wins). */
  put(notebook: NotebookJSON): Promise<void>
  /**
   * Compare-and-swap write: persist `notebook` only if no newer version exists
   * since the caller's `base` timestamp. Returns `{ ok: false, current }` when a
   * newer record is already stored, so the caller can resolve the conflict.
   */
  putIfNewer(notebook: NotebookJSON, base: number | null): Promise<PutResult>
  /** Delete a notebook by id. No-op if it does not exist. */
  delete(id: string): Promise<void>
  /** All notebooks, most recently edited first. */
  list(): Promise<NotebookJSON[]>
  /** Remove every notebook held by this backend. */
  clearAll(): Promise<void>
}
