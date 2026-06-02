// IndexedDB persistence for notebooks via `idb`.
//
// Thin CRUD over a single object store keyed by notebook id, with an index on
// `updatedAt` for "most recently edited" ordering (used by the notebook list,
// Epic 04). Reads run every record through `applyMigrations`, so older stored
// formats are upgraded and validated before they reach the app — anything that
// fails validation is rejected at this boundary (AGENTS.md §11).
//
// IndexedDB is intentionally chosen over localStorage: it scales to many
// notebooks and large payloads, and gives us the `updatedAt` index for free.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { applyMigrations, NewerFormatError } from './migrations'
import type { NotebookJSON } from './schema'

const DB_NAME = 'js-notebook'
const DB_VERSION = 1
const STORE = 'notebooks'

interface NotebookDB extends DBSchema {
  [STORE]: {
    key: string
    value: NotebookJSON
    indexes: { updatedAt: number }
  }
}

let dbPromise: Promise<IDBPDatabase<NotebookDB>> | undefined

function getDB(): Promise<IDBPDatabase<NotebookDB>> {
  if (!dbPromise) {
    dbPromise = openDB<NotebookDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('updatedAt', 'updatedAt')
      },
    }).catch((err) => {
      // Don't cache a rejected open (blocked DB, private mode): otherwise every
      // later call reuses the failed promise and a "Save failed — retry" can
      // never reopen the database. Clear the cache so the next call retries.
      dbPromise = undefined
      throw err
    })
  }
  return dbPromise
}

/** Read one notebook by id, migrated + validated. `undefined` if absent. */
export async function get(id: string): Promise<NotebookJSON | undefined> {
  const raw = await (await getDB()).get(STORE, id)
  if (raw === undefined) return undefined
  return applyMigrations(raw)
}

/** All notebooks, most recently edited first. Invalid records are skipped. */
export async function list(): Promise<NotebookJSON[]> {
  const raw = await (await getDB()).getAllFromIndex(STORE, 'updatedAt')
  const valid: NotebookJSON[] = []
  for (const item of raw) {
    try {
      valid.push(applyMigrations(item))
    } catch {
      // A single corrupt record must not break listing the rest.
    }
  }
  // idb returns ascending index order; we want newest first.
  return valid.reverse()
}

/** Insert or replace a notebook unconditionally (last-write-wins). */
export async function put(notebook: NotebookJSON): Promise<void> {
  await (await getDB()).put(STORE, notebook)
}

/** Outcome of a conditional write. */
export type PutResult =
  | { ok: true }
  /** Another writer got there first; `current` is the newer stored version. */
  | { ok: false; current: NotebookJSON }

/**
 * Compare-and-swap write: persist `notebook` only if no other tab has written
 * a newer version since this tab's `base` timestamp. Read and write happen in
 * ONE `readwrite` transaction, so the check is atomic — IndexedDB serializes
 * readwrite transactions on a store, closing the read-modify-write race that a
 * separate `get` + `put` would leave open between two tabs.
 *
 * Returns `{ ok: true }` on a successful write. If a newer record is already
 * stored (`stored.updatedAt > base`), the write is skipped and the newer
 * `current` is returned so the caller can resolve the conflict instead of
 * silently overwriting it. A `base` of `null` means "this tab has no known
 * baseline yet" and only writes into an empty slot. A stored record that fails
 * validation is treated as absent and overwritten (best-effort recovery from a
 * corrupt slot), but a `NewerFormatError` is re-thrown so an older client never
 * downgrades a notebook it cannot understand.
 */
export async function putIfNewer(notebook: NotebookJSON, base: number | null): Promise<PutResult> {
  const db = await getDB()
  const tx = db.transaction(STORE, 'readwrite')
  // No `await` on anything outside this transaction between get and put — that
  // would let idb auto-commit the tx early. `applyMigrations` is synchronous.
  const existingRaw = await tx.store.get(notebook.id)
  let existing: NotebookJSON | undefined
  if (existingRaw !== undefined) {
    try {
      existing = applyMigrations(existingRaw)
    } catch (error) {
      if (error instanceof NewerFormatError) throw error
      existing = undefined // corrupt slot — overwrite it
    }
  }
  if (existing && (base === null || existing.updatedAt > base)) {
    await tx.done
    return { ok: false, current: existing }
  }
  await tx.store.put(notebook)
  await tx.done
  return { ok: true }
}

/** Delete a notebook by id. No-op if it does not exist. */
export async function remove(id: string): Promise<void> {
  await (await getDB()).delete(STORE, id)
}

/** Remove all notebooks. Primarily for tests and "reset local data". */
export async function clear(): Promise<void> {
  await (await getDB()).clear(STORE)
}
