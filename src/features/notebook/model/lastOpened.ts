// Per-user "last opened notebook" persistence (TARDIS-183).
//
// The id of the notebook currently in the editor slot lives only in-memory
// (`activeNotebookIdAtom`) and resets on reload. To let the startup resolver
// reopen the last notebook the user was on, we persist that id here.
//
// SAFETY (AGENTS §11, cross-account): localStorage is shared by every account on
// the device, so the id MUST be namespaced by `user.id` — a single global key
// would let account B open account A's notebook on sign-in (a leak). On top of
// the per-user key, `resolveOwnedLastOpenedId` re-verifies ownership before the
// id is trusted, using the SAME provable-ownership check as boot
// (`listOwnedLocalNotebooks`), never the server list (which would fire a hidden
// `GET /notebooks`).
//
// Stored in localStorage (NOT IndexedDB like the seed tombstone) because the
// startup resolver reads it SYNCHRONOUSLY on boot, before async stores settle.

import { userAtom } from '@/entities/session'
import { listOwnedLocalNotebooks, LOCAL_NOTEBOOK_ID } from './notebook'

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
 * The current user's last-opened notebook id, but ONLY when it provably belongs
 * to them right now; otherwise `null`. Ownership is checked against
 * `listOwnedLocalNotebooks()` (the same provable-ownership set boot uses), NOT
 * the server list — reading `notebookListResource.data()` here would make the
 * resource hot and fire an extra `GET /notebooks`.
 *
 * Returns `null` (caller falls back to the newest notebook) when: signed out,
 * no stored id, or the stored id is not among the user's owned local notebooks
 * (e.g. it belongs to another account, or only exists on the server with no
 * local copy yet).
 */
export async function resolveOwnedLastOpenedId(): Promise<string | null> {
  const lastId = readLastOpenedId(userAtom()?.id)
  if (!lastId) return null
  const owned = await listOwnedLocalNotebooks()
  return owned.some((nb) => nb.id === lastId) ? lastId : null
}
