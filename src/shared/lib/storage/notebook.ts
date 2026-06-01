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
import { applyMigrations } from '@/features/notebook/persistence/migrations'
import type { NotebookJSON } from '@/features/notebook/persistence/schema'

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

/** Insert or replace a notebook. */
export async function put(notebook: NotebookJSON): Promise<void> {
  await (await getDB()).put(STORE, notebook)
}

/** Delete a notebook by id. No-op if it does not exist. */
export async function remove(id: string): Promise<void> {
  await (await getDB()).delete(STORE, id)
}

/** Remove all notebooks. Primarily for tests and "reset local data". */
export async function clear(): Promise<void> {
  await (await getDB()).clear(STORE)
}
