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
import type { NotebookStorageAdapter } from './storageAdapter'

export function createMemoryAdapter(): NotebookStorageAdapter {
  const store = new Map<string, NotebookJSON>()

  return {
    async get(id) {
      return store.get(id)
    },
    async put(notebook) {
      store.set(notebook.id, notebook)
    },
    async putIfNewer(notebook, base) {
      // Same compare-and-swap baseline rule as the disk backend, so swapping the
      // active adapter never changes autosave's conflict semantics.
      const existing = store.get(notebook.id)
      if (existing && (base === null || existing.updatedAt > base)) {
        return { ok: false, current: existing }
      }
      store.set(notebook.id, notebook)
      return { ok: true }
    },
    async delete(id) {
      store.delete(id)
    },
    async list() {
      // Most recently edited first, mirroring the disk backend's ordering.
      return [...store.values()].sort((a, b) => b.updatedAt - a.updatedAt)
    },
    async clearAll() {
      store.clear()
    },
  }
}
