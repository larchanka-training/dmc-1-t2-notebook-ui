import {
  action,
  computed,
  withAsync,
  withAsyncData,
  withRollback,
  withTransaction,
  wrap,
} from '@reatom/core'
import { notebook as notebookApi } from '@/shared/api'
import { userAtom } from '@/entities/session'
import { newId } from '@/shared/lib/id'
import { FORMAT_VERSION } from '../persistence/schema'
import { notebookStorage } from '../persistence/activeStorage'
import { activeNotebookIdAtom, LOCAL_NOTEBOOK_ID } from './notebook'
import {
  bumpSlotGeneration,
  quiesceActiveSlot,
  resetSlotToFloorForAccountChange,
  restoreActiveSlotBindings,
  settleDeletedSlotToFloor,
} from './slot'

export const notebookListResource = computed(
  async () => await wrap(notebookApi.list()),
  'notebook.list',
).extend(withAsyncData({ initState: [] as notebookApi.NotebookListItem[] }))

notebookListResource.data.extend(withRollback())

/**
 * Keep the sidebar list in step with the signed-in account (#135). The resource
 * is a `computed` over `notebookApi.list()` that does NOT read `userAtom`, so it
 * never re-runs on its own when the account changes within one session (sign-out
 * → sign-in, or account B after account A on a shared device). Without this, the
 * cached rows of the previous account would linger — both a staleness bug and a
 * cross-account leak (§11).
 *
 * On every owner change: drop the cached rows synchronously, reset the editor
 * slot away from the previous owner, and only THEN refetch for the new account.
 * Ordering matters (review H3): `resetSlotToFloorForAccountChange` awaits the
 * autosave drain before it moves the visible slot, so kicking off the new list
 * fetch first would let the new account's rows render while the previous owner's
 * notebook is still on screen. The retry is gated on the owner being unchanged
 * across the await, so a rapid second account switch cannot fetch for a stale
 * owner. The initial synchronous emit is skipped — boot loads the list lazily
 * through the sidebar's own subscription, so there is no redundant fetch on
 * startup. Returns an unsubscribe handle.
 */
export function startNotebookListSync(): () => void {
  let primed = false
  let lastOwnerId: string | null = null
  return userAtom.subscribe((user) => {
    const ownerId = user?.id ?? null
    if (!primed) {
      primed = true
      lastOwnerId = ownerId
      return
    }
    if (ownerId === lastOwnerId) return
    lastOwnerId = ownerId
    // Drop the previous account's cached rows synchronously, before any await, so
    // a foreign list cannot flash while the slot reset is still draining.
    notebookListResource.reset()
    // Reset the editor slot away from the previous owner, THEN (signed in) refetch
    // the new account's list behind an owner fence so a stale owner never wins.
    void (async () => {
      await wrap(resetSlotToFloorForAccountChange())
      if (ownerId !== null && ownerId === lastOwnerId) await wrap(notebookListResource.retry())
    })()
  })
}

/** Project a full notebook onto the lightweight list row (same id; FU2 reconcile). */
function toListItem(nb: notebookApi.Notebook): notebookApi.NotebookListItem {
  return {
    id: nb.id,
    title: nb.title,
    formatVersion: nb.formatVersion,
    createdAt: nb.createdAt,
    updatedAt: nb.updatedAt,
    cellsCount: nb.cells.length,
  }
}

// Model-level in-flight guard (CL-12): the sidebar disables the "+" while a create
// is pending, but that is UX only — a second entry point (a shortcut, command
// palette, or a direct call) could still fire overlapping creates, each minting a
// new UUID + optimistic row + POST. The concurrency rule belongs in the model, so
// an overlapping call is a no-op until the first settles.
let createInFlight = false

export const createNotebookAction = action(async (title: string) => {
  const trimmed = title.trim()
  if (!trimmed) return null
  if (createInFlight) return null
  createInFlight = true

  // Client-chosen UUID (FU1): the same id is both the optimistic row id AND the
  // `id` sent to POST. Server create is idempotent on the client id, so a lost
  // POST response retried by autosync (#134) cannot create a duplicate notebook.
  const id = newId()
  const now = Date.now()
  const optimistic: notebookApi.NotebookListItem = {
    id,
    title: trimmed,
    formatVersion: FORMAT_VERSION,
    createdAt: now,
    updatedAt: now,
    cellsCount: 0,
  }
  try {
    notebookListResource.data.set((items) => [...items, optimistic])

    const nb = await wrap(notebookApi.create({ id, title: trimmed, formatVersion: FORMAT_VERSION }))
    await wrap(notebookStorage.put({ ...nb, cells: nb.cells.map((cell) => ({ ...cell })) }))
    // FU2: reconcile the optimistic row with the server's authoritative values
    // (same id) BEFORE the refetch, so the row is correct even if the refetch
    // fails. Without this, a transient list failure after a committed POST would
    // roll the optimistic row back under withTransaction() — a false "create
    // failed" for a notebook that already exists on the server.
    notebookListResource.data.set((items) =>
      items.map((it) => (it.id === id ? toListItem(nb) : it)),
    )
    try {
      await wrap(notebookListResource.retry())
    } catch {
      // Best-effort refetch: the list invalidation is advisory. The reconciled
      // optimistic row stands until the next successful load. The create itself
      // succeeded, so we must not reject (that would roll the row back).
    }
    return nb
  } finally {
    createInFlight = false
  }
}, 'notebook.list.create').extend(withAsync(), withTransaction())

/**
 * Delete a notebook from the sidebar (#135). Optimistically drops the row (rolled
 * back by `withRollback`/`withTransaction` if the server `DELETE` fails, like
 * create), soft-deletes it server-side, then removes its local copy AND sync-state
 * (per-notebook cleanup — NOT a device-mode wipe, that is #136).
 *
 * If the deleted notebook is the one open in the slot, its bindings are stopped
 * and the slot degrades to the welcome-seed floor FIRST — otherwise autosave /
 * remote-sync would immediately recreate the id we just deleted. The local-only
 * floor (`LOCAL_NOTEBOOK_ID`) has no backend identity and is regenerated on boot,
 * so it is never deletable; callers gate the Delete affordance on that.
 */
export const deleteNotebookAction = action(async (id: string): Promise<void> => {
  // M5 guard: the local welcome floor has no backend identity and is regenerated
  // on boot, so it is never deletable. Reject early — before any list mutation or
  // server call — so a stray listed row or a direct model call can't destroy it
  // (a DELETE would 404 and the optimistic removal would churn the list).
  if (id === LOCAL_NOTEBOOK_ID) {
    console.warn('notebook.delete: refusing to delete the local welcome floor')
    return
  }

  const wasActive = id === activeNotebookIdAtom()

  // Invalidate any in-flight open BEFORE the delete touches the slot/server (H2):
  // a local-first open of THIS id may still have its background GET in flight, and
  // would otherwise re-adopt the notebook we are deleting after the DELETE +
  // local cleanup. Bumping the generation makes that open bail (`superseded`).
  // Done for inactive deletes too — an open of `id` need not be the active slot.
  bumpSlotGeneration()

  // H1: if the notebook is open, quiesce its id-bound work BEFORE the server
  // DELETE — flush the pending save and stop autosave/remote-sync — so no
  // in-flight push or fresh edit can re-create the id mid-delete. The id is NOT
  // flipped yet, so the slot can be restored verbatim if the DELETE fails.
  if (wasActive) {
    await wrap(quiesceActiveSlot())
  }

  // Optimistically remove the row; a failed DELETE rolls it back (withTransaction).
  notebookListResource.data.set((items) => items.filter((it) => it.id !== id))

  try {
    await wrap(notebookApi.remove(id))
  } catch (error) {
    // The DELETE failed (offline/5xx). withTransaction will roll the row back; we
    // must also re-arm the slot we quiesced, so the user is left exactly where
    // they were (open notebook, bindings live, pending edits intact). Re-throw so
    // the transaction rolls back and the dialog surfaces the failure.
    if (wasActive) restoreActiveSlotBindings()
    throw error
  }

  // DELETE committed. From here nothing may throw out of the action, or
  // withTransaction would roll back a delete that already succeeded server-side
  // (H2). Both remaining steps are best-effort.
  if (wasActive) {
    // Degrade the slot to the welcome floor. `settleDeletedSlotToFloor` is itself
    // best-effort, but wrap it here too (defence in depth, H2): NOTHING after the
    // committed DELETE may reject out of this `withTransaction` action, or it
    // would roll back a delete that already succeeded server-side.
    try {
      await wrap(settleDeletedSlotToFloor())
    } catch (error) {
      console.error('notebook.delete: settling the slot to the floor failed', error)
    }
  }
  // Drop the local copy + its sync queue. Best-effort: a storage hiccup must not
  // rethrow (the notebook IS deleted server-side). Log instead of swallowing
  // silently — an orphaned dirty sync-state can later block re-opening that id.
  try {
    await wrap(notebookStorage.delete(id))
    await wrap(notebookStorage.deleteSyncState(id))
  } catch (error) {
    console.warn(`notebook.delete: local cleanup failed for ${id}; orphan may remain`, error)
  }
}, 'notebook.list.delete').extend(withAsync(), withTransaction())
