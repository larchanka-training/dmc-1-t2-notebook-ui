// The on-disk notebook storage backend: the default `NotebookStorageAdapter`.
//
// A thin mapping over the low-level IndexedDB module (`storage.ts`) — that module
// stays the implementation detail, this object is the contract autosave/load see.
// Only two method names differ from the low-level functions: `delete → remove`
// and `clearAll → clear` (the low-level names predate the adapter, and `delete`
// is a reserved word for a bare function export).

import type { NotebookStorageAdapter } from './storageAdapter'
import { clear, get, list, put, putIfNewer, remove } from './storage'

export const indexedDbAdapter: NotebookStorageAdapter = {
  get,
  put,
  putIfNewer,
  delete: remove,
  list,
  clearAll: clear,
}
