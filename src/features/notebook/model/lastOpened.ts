// Per-user "last opened notebook" persistence (TARDIS-183).
//
// The id of the notebook currently in the editor slot lives only in-memory
// (`activeNotebookIdAtom`) and resets on reload. To let the startup resolver
// reopen the last notebook the user was on, we persist that id here.
//
// SAFETY (AGENTS §11, cross-account): localStorage is shared by every account on
// the device, so the id MUST be namespaced by `user.id` — a single global key
// would let account B open account A's notebook on sign-in (a leak). The id is
// written (`writeLastOpenedId`) only when THIS user opened the notebook, so the
// per-user key already proves ownership at write time; `resolveOwnedLastOpenedId`
// only checks a local copy exists and rejects a copy stamped with a DIFFERENT
// owner (the negative cross-account guard), instead of re-deriving ownership.
//
// Stored in localStorage (NOT IndexedDB like the seed tombstone) because the
// startup resolver reads it SYNCHRONOUSLY on boot, before async stores settle.

import { wrap } from '@reatom/core'
import { userAtom } from '@/entities/session'
import { notebookStorage } from '../persistence/activeStorage'
import { LOCAL_NOTEBOOK_ID } from './notebook'

const LAST_OPENED_KEY_PREFIX = 'notebook:lastOpened:'

/** localStorage key for a given user's last-opened id. Lower-cased like the
 *  other per-account keys (seed tombstone / owner ids) so casing can't split it. */
function lastOpenedKey(userId: string): string {
  return `${LAST_OPENED_KEY_PREFIX}${userId.toLowerCase()}`
}

/**
 * Read the stored last-opened notebook id for `userId`, or `null` when there is
 * none (or when signed out / storage is unavailable). `userId` is nullable so
 * callers can pass `userAtom()?.id` directly without their own guard.
 */
export function readLastOpenedId(userId: string | null | undefined): string | null {
  if (!userId || typeof localStorage === 'undefined') return null
  try {
    return localStorage.getItem(lastOpenedKey(userId))
  } catch {
    return null
  }
}

/**
 * Persist `id` as the last-opened notebook for `userId`. No-op when signed out,
 * when storage is unavailable, or for the local welcome floor id — the legacy
 * floor must never become a "last opened" target (it is not a real, syncable
 * notebook identity). `userId` is nullable so callers can pass `userAtom()?.id`
 * directly. (`LEGACY_LOCAL_NOTEBOOK_ID === LOCAL_NOTEBOOK_ID`, so guarding the
 * one constant covers both.)
 */
export function writeLastOpenedId(userId: string | null | undefined, id: string): void {
  if (!userId || typeof localStorage === 'undefined') return
  if (id === LOCAL_NOTEBOOK_ID) return
  try {
    localStorage.setItem(lastOpenedKey(userId), id)
  } catch {
    // Storage full / disabled — the last-opened id simply doesn't persist this
    // session; the resolver falls back to the newest notebook.
  }
}

/**
 * The current user's last-opened notebook id when it is safe to reopen on boot,
 * otherwise `null` (caller falls back to the newest notebook).
 *
 * Ownership is NOT re-derived from sync-state here (TARDIS-183 follow-up): the
 * per-user key already proves the current user opened this id, so requiring a
 * sync-state `ownerId` stamp wrongly rejected a server notebook that was merely
 * OPENED (never edited) — `pullServerNotebook` writes the document without a
 * sync-state, so the slot used to fall back to a different notebook. Instead:
 *
 *   1. a local copy must exist (nothing to open without the network otherwise);
 *   2. NEGATIVE cross-account guard (§11): if that copy carries a sync-state with
 *      a DIFFERENT `ownerId`, reject it — a missing or matching owner passes.
 *
 * Reads storage directly, never `notebookListResource.data()` (that would make
 * the resource hot and fire a hidden `GET /notebooks`).
 *
 * Returns `null` when: signed out, no stored id, no local copy, or the copy is
 * stamped with another account's owner.
 */
export async function resolveOwnedLastOpenedId(): Promise<string | null> {
  const ownerId = userAtom()?.id?.toLowerCase()
  const lastId = readLastOpenedId(userAtom()?.id)
  if (!ownerId || !lastId) return null
  // A local copy must exist to open without the network.
  const local = await wrap(notebookStorage.get(lastId))
  if (!local) return null
  // Negative owner guard: reject only an explicitly FOREIGN-owned copy. A copy
  // with no sync-state (server notebook just opened, never stamped) or one owned
  // by this user passes — the per-user key already established it is ours.
  const state = await wrap(notebookStorage.getSyncState(lastId))
  if (state?.ownerId && state.ownerId.toLowerCase() !== ownerId) return null
  return lastId
}
