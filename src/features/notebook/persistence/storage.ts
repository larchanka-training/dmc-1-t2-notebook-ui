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
import {
  isNotebookSyncState,
  isStaleWrite,
  type NotebookSyncState,
  type PutResult,
} from './storageAdapter'

const DB_NAME = 'js-notebook'
// v2 (#134) adds the `sync` store for the autosync metadata partition. The
// migration is additive and version-guarded (see `upgrade` below): the existing
// `notebooks` store and its records are never re-created or cleared, so a user's
// local-only notebook survives the bump untouched.
// v3 (TARDIS-167 №23) adds the `meta` store for per-account durable markers —
// currently the deleted-seed tombstone, so a deleted welcome notebook is NOT
// resurrected on the next boot. Additive + version-guarded like the v2 step.
const DB_VERSION = 3
const STORE = 'notebooks'
const SYNC_STORE = 'sync'
const META_STORE = 'meta'

interface NotebookDB extends DBSchema {
  [STORE]: {
    key: string
    value: NotebookJSON
    indexes: { updatedAt: number }
  }
  [SYNC_STORE]: {
    key: string
    value: NotebookSyncState
  }
  [META_STORE]: {
    key: string
    value: unknown
  }
}

let dbPromise: Promise<IDBPDatabase<NotebookDB>> | undefined

function getDB(): Promise<IDBPDatabase<NotebookDB>> {
  if (!dbPromise) {
    dbPromise = openDB<NotebookDB>(DB_NAME, DB_VERSION, {
      // `oldVersion` guards make every step run once and only for DBs below it,
      // so upgrading an existing v1 DB adds the `sync` store WITHOUT touching the
      // `notebooks` store (INV-1: never lose the existing local-only notebook).
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' })
          store.createIndex('updatedAt', 'updatedAt')
        }
        if (oldVersion < 2) {
          db.createObjectStore(SYNC_STORE, { keyPath: 'notebookId' })
        }
        if (oldVersion < 3) {
          // Out-of-line keys: callers pass an explicit string key (e.g. the
          // seed-tombstone key). Notebooks/sync are untouched (INV-1).
          db.createObjectStore(META_STORE)
        }
      },
      // This tab is holding an OLD-version connection open while ANOTHER tab tries
      // to upgrade (e.g. a new build adding a store). Without closing, the other
      // tab's `openDB` hangs (its `blocked` fires) until this tab is closed. Close
      // our handle so the upgrade can proceed and drop the cached promise so the
      // next call here transparently reopens at the new version. Location: #135
      // follow-up (cross-tab #134 v2 upgrade). `db.close()` does NOT fire
      // `terminated`, so clearing `dbPromise` here is the only reset needed.
      blocking(_currentVersion, _blockedVersion, event) {
        console.warn('notebook storage: closing the DB so another tab can upgrade it')
        dbPromise = undefined
        ;(event.target as IDBDatabase | null)?.close()
      },
      // The reverse: ANOTHER tab is holding an old connection open, blocking THIS
      // tab's upgrade. Surface it instead of hanging silently; the open stays
      // pending until the other tab yields (its `blocking` closes it).
      blocked() {
        console.warn('notebook storage: DB upgrade is blocked by another open tab')
      },
      // The browser force-closed the connection (e.g. storage pressure). Drop the
      // cached handle so the next call reopens rather than reusing a dead one.
      terminated() {
        console.warn('notebook storage: DB connection was terminated by the browser')
        dbPromise = undefined
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
  if (existing && isStaleWrite(existing.updatedAt, base)) {
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

/**
 * Remove all notebooks AND all sync-state records, in one transaction. Backs
 * `clearLocalNotebookData()`: an untrusted-device wipe must leave nothing behind,
 * neither notebook content nor the unsynced-change queue / tombstones (#134).
 */
export async function clear(): Promise<void> {
  const db = await getDB()
  const tx = db.transaction([STORE, SYNC_STORE, META_STORE], 'readwrite')
  await Promise.all([
    tx.objectStore(STORE).clear(),
    tx.objectStore(SYNC_STORE).clear(),
    tx.objectStore(META_STORE).clear(),
    tx.done,
  ])
}

// ---------------------------------------------------------------------------
// Meta partition (TARDIS-167 №23): per-account durable markers, keyed by an
// explicit string. Values are opaque to this layer; callers validate on read.
// ---------------------------------------------------------------------------

/** Read a raw meta value by key. `undefined` if absent. */
export async function getMeta(key: string): Promise<unknown> {
  return (await getDB()).get(META_STORE, key)
}

/** Insert or replace a meta value at `key`. */
export async function putMeta(key: string, value: unknown): Promise<void> {
  await (await getDB()).put(META_STORE, value, key)
}

/** Delete a meta value by key. No-op if absent. */
export async function deleteMeta(key: string): Promise<void> {
  await (await getDB()).delete(META_STORE, key)
}

/** Read one notebook's sync state, validated. `undefined` if absent or corrupt. */
export async function getSyncState(notebookId: string): Promise<NotebookSyncState | undefined> {
  const raw = await (await getDB()).get(SYNC_STORE, notebookId)
  if (raw === undefined) return undefined
  // A corrupt bookkeeping record is treated as absent (the engine re-initialises
  // it), never thrown — sync metadata must not crash boot/autosave.
  return isNotebookSyncState(raw) ? raw : undefined
}

/** Insert or replace one notebook's sync state (keyed by `notebookId`). */
export async function putSyncState(state: NotebookSyncState): Promise<void> {
  await (await getDB()).put(SYNC_STORE, state)
}

/** Delete one notebook's sync state. No-op if it does not exist. */
export async function deleteSyncState(notebookId: string): Promise<void> {
  await (await getDB()).delete(SYNC_STORE, notebookId)
}
