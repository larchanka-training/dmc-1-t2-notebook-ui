// The active notebook storage facade: the single object autosave and boot-time
// load talk to, and the seam where the active backend is chosen.
//
// `notebookStorage` is a stable singleton that delegates every call to whatever
// backend is currently active. The default — and only — active backend in this
// task is IndexedDB (on-disk), so the user-facing behaviour is unchanged.
// Routing through this delegate (rather than letting callers import a concrete
// adapter) is what lets #136 swap disk for the in-memory backend without
// touching the autosave/load logic. The public setter that performs the swap is
// deferred to #136: `active` is `const` here because nothing reassigns it yet —
// #136 flips it to `let` and adds the setter. There is no way to leave IndexedDB
// in this task.
//
// Every method is reached through this object at call time (property access, not
// a captured reference), so tests can `vi.spyOn(notebookStorage, …)` and the spy
// intercepts the real call. This is load-bearing: tested code must call
// `notebookStorage.get(…)` (property access), never destructure
// `const { get } = notebookStorage` — a captured method skips the spy seam and
// would also not follow the #136 backend swap.

import { indexedDbAdapter } from './indexedDbAdapter'
import type { NotebookStorageAdapter } from './storageAdapter'

const active: NotebookStorageAdapter = indexedDbAdapter

/**
 * The currently active storage backend (IndexedDB until #136 enables the swap).
 * Read it per call — do not cache the returned adapter: a held reference bypasses
 * the spyable `notebookStorage` delegate and would not follow a future swap.
 */
export function getActiveNotebookStorage(): NotebookStorageAdapter {
  return active
}

/** Stable delegate to the active backend — the one storage entry point for callers. */
export const notebookStorage: NotebookStorageAdapter = {
  get: (id) => active.get(id),
  put: (notebook) => active.put(notebook),
  putIfNewer: (notebook, base) => active.putIfNewer(notebook, base),
  delete: (id) => active.delete(id),
  list: () => active.list(),
  clearAll: () => active.clearAll(),
  getSyncState: (id) => active.getSyncState(id),
  putSyncState: (state) => active.putSyncState(state),
  deleteSyncState: (id) => active.deleteSyncState(id),
}

/**
 * Erase locally stored notebook content. Intended for sign-out on an untrusted
 * device (#136): after this resolves, the device holds no notebook data in the
 * active backend.
 *
 * Scope caveat for #136: this clears only the *active* backend. Once #136 can
 * make memory the active backend, an authoritative wipe must also clear
 * IndexedDB unconditionally — otherwise untrusted-device sign-out clears memory
 * while the real notebooks stay on disk (a false "wiped" signal). Define that
 * all-backends wipe in #136 before wiring this to sign-out.
 *
 * The #134 unsynced-change queue and `deletedCells` live in the same backend's
 * sync-metadata partition, and `clearAll()` wipes that partition together with
 * the notebooks — so this one call leaves nothing behind.
 */
export async function clearLocalNotebookData(): Promise<void> {
  // Hits the raw active backend, not the `notebookStorage` delegate, on purpose:
  // a maintenance wipe, not part of the spied save/load path.
  await active.clearAll()
}
