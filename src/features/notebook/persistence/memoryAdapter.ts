// The in-memory notebook storage backend: a `NotebookStorageAdapter` that keeps
// notebooks only in JS memory. Data is lost when the tab closes or a new adapter
// instance is created — that volatility is the point. It backs the future
// untrusted-device mode (#136), where a public browser must not leave notebook
// contents on disk.
//
// Created via a factory (not a module singleton) so each call yields an isolated
// store: a fresh adapter starts empty. Not wired into the running app in this
// task — the active backend stays IndexedDB (#133) — only exercised by its tests
// until #136 enables the swap.
//
// Unlike the disk backend it never runs `applyMigrations` / raises
// `NewerFormatError`: it only ever holds typed `NotebookJSON` written through its
// own `put`/`putIfNewer` in the current session, so foreign or older-format
// records can never enter it. It touches nothing outside its own Map — no
// IndexedDB, localStorage or sessionStorage.

import type { NotebookJSON } from './schema'
import { isStaleWrite, type NotebookStorageAdapter } from './storageAdapter'

// Snapshot on every boundary, matching IndexedDB's structured-clone semantics:
// store a copy on write, hand back a copy on read. Otherwise the Map would hold
// caller-owned references, so mutating a `get` / `list` / failed-CAS `current`
// result — or the object handed to `put` — would retro-mutate the store and
// corrupt the CAS baseline. `structuredClone` is the algorithm IndexedDB itself
// uses to persist, so both backends observe the same snapshot contract.
const snapshot = (notebook: NotebookJSON): NotebookJSON => structuredClone(notebook)

export function createMemoryAdapter(): NotebookStorageAdapter {
  const store = new Map<string, NotebookJSON>()

  return {
    async get(id) {
      const stored = store.get(id)
      return stored && snapshot(stored)
    },
    async put(notebook) {
      store.set(notebook.id, snapshot(notebook))
    },
    async putIfNewer(notebook, base) {
      // Shared `isStaleWrite` conflict rule from the contract — same decision as
      // the disk backend, so swapping the active adapter never changes
      // autosave's conflict semantics.
      const existing = store.get(notebook.id)
      if (existing && isStaleWrite(existing.updatedAt, base)) {
        return { ok: false, current: snapshot(existing) }
      }
      store.set(notebook.id, snapshot(notebook))
      return { ok: true }
    },
    async delete(id) {
      store.delete(id)
    },
    async list() {
      // Most recently edited first, mirroring the disk backend's ordering; each
      // element is a snapshot so a caller cannot mutate the stored copy.
      return [...store.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(snapshot)
    },
    async clearAll() {
      store.clear()
    },
  }
}
