// Accept-server-version pull (#135): write ONE server notebook into local
// storage, honouring the conflict rule. Pull does no cell-level merge — the only
// merge is the server's last-write-wins via PATCH (#134). A clean or absent local
// copy takes the server version as-is; a locally-dirty copy is kept untouched so
// the next background PATCH ships its changes to the server merge first, and that
// response becomes the new baseline.
//
// Side effects are limited to a single storage read (sync-state) + at most one
// storage write. No network here: the caller hands in an already-fetched notebook
// (the lazy single GET lives in the slot controller), so this stays a pure,
// unit-testable decision over storage state.

import { wrap } from '@reatom/core'
import type { notebook as notebookApi } from '@/shared/api'
import { userAtom } from '@/entities/session'
import { notebookStorage } from '../persistence/activeStorage'
import { isNotebookJSON } from '../persistence/schema'
import { serverNotebookToJSON } from './remoteSyncCore'
import { activeNotebookIdAtom } from './notebook'
import { hasLocalChangesAtom } from './autosave'

export type PullOutcome =
  // The server version was written to local storage.
  | 'accepted'
  // Local has unsynced changes; the server version was NOT written (push wins next).
  | 'kept-local-dirty'
  // The server payload is not a valid notebook; nothing was written (§11).
  | 'rejected'

/**
 * Whether the local copy of `id` has changes the server has not acked yet, so a
 * pull must not overwrite it. Two sources:
 *   1. The durable per-notebook sync state (`dirty`, pending tombstones, or an
 *      unresolved owner conflict) — authoritative for a notebook that is NOT open
 *      in the editor (the bootstrap case).
 *   2. The open editor's in-memory `hasLocalChangesAtom` — closes the window
 *      between a keystroke and the autosave/sync commit that would set `dirty`,
 *      but only for the notebook currently in the slot.
 */
async function hasUnsyncedLocalChanges(id: string): Promise<boolean> {
  const state = await wrap(notebookStorage.getSyncState(id))
  if (state && (state.dirty || state.deletedCells.length > 0 || state.ownerConflict === true)) {
    return true
  }
  if (id === activeNotebookIdAtom() && hasLocalChangesAtom()) return true
  return false
}

/**
 * Persist one server notebook locally under the conflict rule. Returns the
 * outcome so the caller (bootstrap / open-into-slot) can decide what to do next
 * without inspecting storage itself.
 */
export async function pullServerNotebook(server: notebookApi.Notebook): Promise<PullOutcome> {
  const json = serverNotebookToJSON(server)
  // Boundary validation (§11): a malformed 2xx must never reach storage, where it
  // could pose as authoritative content.
  if (!isNotebookJSON(json)) return 'rejected'
  // Capture the local baseline BEFORE the dirty check, not between it and the
  // write (review M1). The CAS base must be the version we decided against; if we
  // re-read it after the dirty check, a local write landing in that window would
  // become the base and the server copy would silently overwrite that unsynced
  // edit. Reading it first means any write that lands during the whole pull
  // decision bumps `updatedAt` past this baseline, so `putIfNewer`'s in-transaction
  // CAS rejects the overwrite. `wrap` re-binds the Reatom frame across the await so
  // the reads below run IN-FRAME under production `clearStack()`.
  const baseline = await wrap(notebookStorage.get(json.id))
  if (await wrap(hasUnsyncedLocalChanges(json.id))) return 'kept-local-dirty'
  // Server wins for a clean/absent copy — but write under a compare-and-swap, not
  // an unconditional put (CL-17): `putIfNewer` re-reads and writes in one
  // transaction against the pre-decision baseline, so a newer local version that
  // raced the pull is never clobbered; if it lost the race we treat it as a
  // dirty-keep, not an overwrite.
  const result = await wrap(notebookStorage.putIfNewer(json, baseline?.updatedAt ?? null))
  return result.ok ? 'accepted' : 'kept-local-dirty'
}

/**
 * Stamp a just-pulled server notebook with the current user's ownership
 * sync-state, but ONLY when no sync-state exists yet (TARDIS-183 blocker fix).
 *
 * `pullServerNotebook` writes the document only, no sync-state. Ownership of a
 * non-seed notebook lives solely in `NotebookSyncState.ownerId`
 * (`listOwnedLocalNotebooks`), so a server notebook merely OPENED (never edited)
 * stays "unowned" locally — and the startup resolver then rejects it as the
 * last-opened target and falls back to another notebook. `bootReconcile` already
 * stamps its pulled notebook for exactly this reason; this is the same stamp for
 * the open-into-slot path, factored out so the two cannot drift.
 *
 * SAFETY (§11): the GET that produced this notebook ran under the current user's
 * JWT and the server only returns that user's notebooks, so stamping it as theirs
 * is provably correct. The `if (existing)` guard never overwrites another
 * account's `ownerId` / `dirty` / tombstones — it only fills the gap where there
 * is no sync-state at all. No-op when signed out (no owner to stamp).
 */
export async function stampServerNotebookOwnerIfUnowned(
  server: notebookApi.Notebook,
): Promise<void> {
  const ownerId = userAtom()?.id
  if (!ownerId) return
  const existing = await wrap(notebookStorage.getSyncState(server.id))
  if (existing) return
  await wrap(
    notebookStorage.putSyncState({
      notebookId: server.id,
      remoteCreated: true,
      dirty: false,
      deletedCells: [],
      ownerId,
      lastSyncedUpdatedAt: server.updatedAt,
    }),
  )
}
