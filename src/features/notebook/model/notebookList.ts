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
import { activeNotebookIdAtom } from './notebook'
import { degradeSlotToFloor } from './slot'

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
 * On every owner change: reset the cached rows (so a foreign list cannot flash),
 * then, when signed in, refetch for the new account. The initial synchronous emit
 * is skipped — boot loads the list lazily through the sidebar's own subscription,
 * so there is no redundant fetch on startup. Returns an unsubscribe handle.
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
    // Drop the previous account's rows before anything can render them.
    notebookListResource.reset()
    // Signed in → load the new account's list; signed out → leave it empty.
    if (ownerId !== null) void notebookListResource.retry()
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
  const wasActive = id === activeNotebookIdAtom()
  // Optimistically remove the row; a failed DELETE rolls it back (withTransaction).
  notebookListResource.data.set((items) => items.filter((it) => it.id !== id))
  // Server delete FIRST. If it throws (offline/500), withTransaction rolls the row
  // back and — crucially — the slot is still intact (CL-4): we have not degraded it
  // yet, so a failed delete of the OPEN notebook leaves the user exactly where they
  // were, pending edits and all.
  await wrap(notebookApi.remove(id))
  // Delete committed. Only now vacate the slot if the deleted notebook was open:
  // `degradeSlotToFloor` drains the pending edit, stops the bindings (so autosave /
  // remote-sync cannot recreate the id) and re-seeds the welcome floor.
  if (wasActive) {
    await wrap(degradeSlotToFloor())
  }
  // Drop the local copy + its sync queue. Best-effort: a storage hiccup here must
  // not roll the row back (the notebook IS deleted server-side). Log the failure
  // (CL-6) instead of swallowing it silently — an orphaned dirty sync-state left
  // behind can later block re-opening that server id.
  try {
    await wrap(notebookStorage.delete(id))
    await wrap(notebookStorage.deleteSyncState(id))
  } catch (error) {
    console.warn(`notebook.delete: local cleanup failed for ${id}; orphan may remain`, error)
  }
}, 'notebook.list.delete').extend(withAsync(), withTransaction())
