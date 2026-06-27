import {
  action,
  computed,
  log,
  withAsync,
  withAsyncData,
  withConnectHook,
  withRollback,
  withTransaction,
  wrap,
} from '@reatom/core'
import { notebook as notebookApi } from '@/shared/api'
import { NotFoundError } from '@/shared/api/errors'
import { userAtom } from '@/entities/session'
import { newId } from '@/shared/lib/id'
import { FORMAT_VERSION } from '../persistence/schema'
import { notebookStorage } from '../persistence/activeStorage'
import { activeNotebookIdAtom, LOCAL_NOTEBOOK_ID, resolveDemoNotebookId } from './notebook'
import { setSeedTombstone } from './seedTombstone'
import {
  bumpSlotGeneration,
  openNotebookInSlot,
  quiesceActiveSlot,
  resetSlotToFloorForAccountChange,
  restoreActiveSlotBindings,
  settleDeletedSlotToFloor,
} from './slot'

// Trace every actual GET /notebooks and every caller that triggers a (re)fetch.
// `source` = which file/owner asked, `reason` = why. Routed through the Reatom
// `log` so it lines up with the rest of the dev trace under `connectLogger`.
function logListFetch(event: string, source: string, reason: string): void {
  log(`📒 notebook.list ${event} ← ${source} :: ${reason}`)
}

export const notebookListResource = computed(async () => {
  // This body is the ONE place the network GET /notebooks actually fires for the
  // resource. Whoever made the resource recompute (a first subscriber connecting,
  // or an explicit `.retry()`) shows up in the preceding logs.
  logListFetch('FETCH (resource compute → GET /notebooks)', 'notebookListResource', 'recompute')
  return await wrap(notebookApi.list())
}, 'notebook.list').extend(withAsyncData({ initState: [] as notebookApi.NotebookListItem[] }))

// Log when the resource gains its FIRST subscriber (becomes hot) — in production
// that is the sidebar mounting and reading `data()`. This is the implicit
// trigger that is easy to miss when chasing "who fetched the list".
notebookListResource.extend(
  withConnectHook(() => {
    logListFetch('CONNECT (first subscriber → resource hot)', 'notebookListResource', 'subscribed')
  }),
)

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
 * startup.
 *
 * The explicit retry runs ONLY on a true account SWITCH (B after A, both
 * non-null — e.g. a cross-tab login as another account, which arrives as
 * userAtom A→B with NO null in between). In that case `NotebooksGroup` never
 * unmounts (the user stays truthy), so the list resource stays HOT with the
 * previous account's rows, and the `computed` does not read `userAtom` — so it
 * would not refetch on its own and Bob would see Alice's list. The retry is what
 * refreshes it.
 *
 * It is deliberately SKIPPED on the FIRST sign-in (null → user, i.e. login after
 * logout/boot): there `NotebooksGroup` unmounted while signed out (it returns
 * null without a user), so on sign-in it re-subscribes and the resource's own
 * lazy fetch is the SINGLE source. Retrying here too is the double `GET
 * /notebooks` after login (TARDIS-167 №7). Returns an unsubscribe handle.
 */
export function startNotebookListSync(): () => void {
  let primed = false
  let lastOwnerId: string | null = null
  // The subscribe callback is wrapped in `wrap(...)` so the async work it kicks
  // off carries a Reatom frame. This listener fires from `notify`; a bare
  // `void (async …)()` would detach the stack, and every deep `await wrap(...)`
  // inside `resetSlotToFloorForAccountChange` → `loadNotebook` (storage reads,
  // the boot reconcile, the legacy-seed migration) would then throw
  // `ReatomError: missing async stack` under production `clearStack()` — which
  // aborted the whole first-sign-in boot and left the in-memory seed showing
  // (TARDIS-167 №23). Wrapping the callback (the same pattern remoteSync uses for
  // its `userAtom.subscribe`) keeps the frame across the awaits.
  return userAtom.subscribe(
    wrap((user) => {
      const ownerId = user?.id ?? null
      if (!primed) {
        primed = true
        lastOwnerId = ownerId
        return
      }
      if (ownerId === lastOwnerId) return
      const prevOwnerId = lastOwnerId
      lastOwnerId = ownerId
      // Drop the previous account's cached rows synchronously, before any await, so
      // a foreign list cannot flash while the slot reset is still draining.
      notebookListResource.reset()
      // Reset the editor slot away from the previous owner, THEN refetch the new
      // account's list behind an owner fence so a stale owner never wins.
      void (async () => {
        await wrap(resetSlotToFloorForAccountChange())
        // Refetch ONLY on a true account SWITCH (both owners non-null — e.g. a
        // cross-tab login as another account, A→B with no null between). There the
        // sidebar never unmounted, so the hot resource keeps the previous account's
        // rows and the `computed` won't refetch on its own. On the FIRST sign-in
        // (null→user) this is skipped: the sidebar re-subscribed on sign-in and its
        // own lazy fetch is the single source — retrying here too is the post-login
        // double GET /notebooks (TARDIS-167 №7). The owner fence guards a rapid
        // second switch landing mid-await.
        if (prevOwnerId !== null && ownerId !== null && ownerId === lastOwnerId) {
          logListFetch(
            'RETRY',
            'startNotebookListSync (owner-change subscription)',
            `account switch ${prevOwnerId} → ${ownerId}`,
          )
          await wrap(notebookListResource.retry())
        }
      })()
    }),
  )
}

/**
 * Insert a row into the list keeping the `createdAt desc` order the sidebar is
 * fetched with (review PR #85). A no-op if the id is already present.
 *
 * Used only by the seed-promotion path (`promoteSeedFloorIfUnsynced`), where the
 * promoted notebook can be OLDER than rows already in the list and so needs a
 * real ordered insert. The ordinary `createNotebookAction` does NOT use this: a
 * freshly created notebook is by definition the newest, so it deliberately
 * prepends (`[optimistic, ...items]`) — the cheap equivalent for the newest row.
 */
function insertByCreatedAtDesc(
  items: notebookApi.NotebookListItem[],
  row: notebookApi.NotebookListItem,
): notebookApi.NotebookListItem[] {
  if (items.some((it) => it.id === row.id)) return items
  const at = items.findIndex((it) => it.createdAt <= row.createdAt)
  if (at === -1) return [...items, row]
  const next = [...items]
  next.splice(at, 0, row)
  return next
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

/**
 * TARDIS-167 (#2): keep the sidebar list row's title in step with a rename,
 * locally and WITHOUT a list refetch. The title is persisted via the normal
 * autosave → remote-sync PATCH path; the GET /notebooks list is NOT re-fetched on
 * a rename (that round-trip is what made a freshly renamed notebook show its OLD
 * title in the sidebar after switching to another notebook and back). Patching the
 * cached row in place reconciles the list with the live editor title immediately.
 * A no-op when the id is not a listed row (e.g. the local welcome floor).
 */
export function renameListItem(id: string, title: string): void {
  notebookListResource.data.set((items) =>
    items.some((it) => it.id === id && it.title !== title)
      ? items.map((it) => (it.id === id ? { ...it, title } : it))
      : items,
  )
}

/**
 * TARDIS-167 (№23): add a notebook to the cached sidebar list immediately,
 * WITHOUT waiting for a `GET /notebooks` refetch. Used by the demo Restore flow,
 * which recreates the seed server-side and must surface its row right away —
 * otherwise the seed shows only as the synthetic floor row and vanishes the
 * moment another notebook is opened (until the next list refetch). Ordered by
 * `createdAt desc` to match the fetch order; a no-op if the row already exists.
 */
export function upsertListItem(notebook: notebookApi.Notebook): void {
  notebookListResource.data.set((items) => insertByCreatedAtDesc(items, toListItem(notebook)))
}

/**
 * Number of notebooks the user effectively has (TARDIS-167 №23, B-1). The sidebar
 * and the `deleteNotebookAction` guard MUST agree, or the UI offers a Delete that
 * the model then silently refuses. The synthetic welcome-floor row (the active
 * notebook is not in the backend list — the unsynced seed) counts as one slot.
 */
export function effectiveNotebookCount(): number {
  const items = notebookListResource.data()
  const activeId = activeNotebookIdAtom()
  const floorShown = activeId !== undefined && !items.some((it) => it.id === activeId)
  return items.length + (floorShown ? 1 : 0)
}

/** B-1: deletion is allowed only while the user keeps at least one other notebook. */
export function canDeleteNotebooks(): boolean {
  return effectiveNotebookCount() > 1
}

/**
 * Effective maximum number of notebooks the UI allows (TARDIS-167, review on
 * PR #91 / TARDIS-173). This is NOT a backend create limit — the API has none.
 * The client only ever loads and syncs the first `LIST_PAGE_LIMIT` (200) rows of
 * `GET /notebooks`, so any notebook beyond that page would be invisible in the
 * sidebar and never synced. Capping creation at the page size keeps every
 * notebook the user can make reachable. Derived from the single source
 * (`notebookApi.LIST_PAGE_LIMIT`) so the page size and the cap cannot drift.
 *
 * The welcome seed is counted as one slot (it occupies a listed/floor row like
 * any other), so the practical ceiling is 199 user-created notebooks plus the
 * restorable seed.
 */
export const MAX_NOTEBOOKS = notebookApi.LIST_PAGE_LIMIT

/**
 * Whether the user is below the notebook cap and may create another one. Shares
 * `effectiveNotebookCount()` with the delete guard so the create affordance and
 * the model never disagree (a UI "+" that the model would then refuse). Deleting
 * any notebook drops the count and re-enables creation.
 */
export function canCreateNotebook(): boolean {
  return effectiveNotebookCount() < MAX_NOTEBOOKS
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
  // Cap guard (TARDIS-173): never create past the page-size ceiling the client can
  // load/sync. The sidebar also disables the "+" and shows a tooltip; this is the
  // model-level backstop so a second entry point (shortcut / command palette /
  // direct call) cannot push the user over the limit. Deleting a notebook
  // re-enables creation. No-op rather than throw — the affordance already explains
  // why, and callers treat `null` as "not created".
  if (!canCreateNotebook()) {
    console.warn(`notebook.create: refusing to create past the cap of ${MAX_NOTEBOOKS}`)
    return null
  }
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
    // TARDIS-167 (#3 follow-up): prepend, not append. The list is ordered
    // `createdAt desc` (newest first), and a freshly created notebook is the
    // newest — so it belongs at the TOP. Appending showed it at the bottom for a
    // beat, then the post-create refetch re-ordered it to the top (a visible
    // jump). Optimistically placing it where the server will return it removes
    // that flicker.
    notebookListResource.data.set((items) => [optimistic, ...items])

    const nb = await wrap(notebookApi.create({ id, title: trimmed, formatVersion: FORMAT_VERSION }))
    await wrap(notebookStorage.put({ ...nb, cells: nb.cells.map((cell) => ({ ...cell })) }))
    // TARDIS-167 (#10): the notebook already exists server-side (the POST above
    // succeeded), so seed its sync-state as `remoteCreated` BEFORE the slot opens
    // it. Otherwise the remote-sync engine boots from `initialSyncState`
    // (`remoteCreated: false`) and the first edit re-POSTs the just-created
    // notebook (a phantom create with `cells: []`) before the correct PATCH — the
    // duplicate POST users observed. `lastSyncedUpdatedAt: nb.updatedAt` matches
    // the doc just persisted, so the C-4 boot watermark check does not flag it
    // falsely dirty. `ownerId` is the current account so the owner-gate lets the
    // first real edit push. This write lands before `openNotebookInSlot` starts
    // the engine for this id, so there is no live engine to race.
    await wrap(
      notebookStorage.putSyncState({
        notebookId: id,
        remoteCreated: true,
        dirty: false,
        deletedCells: [],
        ownerId: userAtom()?.id,
        lastSyncedUpdatedAt: nb.updatedAt,
      }),
    )
    // FU2: reconcile the optimistic row with the server's authoritative values
    // (same id) BEFORE the refetch, so the row is correct even if the refetch
    // fails. Without this, a transient list failure after a committed POST would
    // roll the optimistic row back under withTransaction() — a false "create
    // failed" for a notebook that already exists on the server.
    notebookListResource.data.set((items) =>
      items.map((it) => (it.id === id ? toListItem(nb) : it)),
    )
    try {
      logListFetch('RETRY', 'createNotebookAction', 'post-create list reconcile')
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
 * TARDIS-167 (#9): promote the local welcome-seed floor to a real backend
 * notebook BEFORE the user creates their first "real" notebook.
 *
 * The seed floor is shown in the sidebar only as a synthetic row while its id is
 * NOT in the backend list (`showFloorRow = !activeInList`). Creating a new
 * notebook makes that new id the active one, so the floor row vanished even
 * though the seed still existed locally (the #9 report). Promoting the seed gives
 * it a backend identity, so it becomes an ordinary listed row and stays visible.
 *
 * Scope is deliberately narrow — only a CLEAN, never-synced seed is promoted:
 *   - the legacy floor id is never a syncable identity (#135 contract);
 *   - a dirty / already-created seed belongs to the remote-sync engine, which
 *     owns the live in-memory sync-state for the active id. Promoting it from the
 *     outside would race the engine's own POST/PATCH. A clean seed (dirty=false,
 *     not remoteCreated, no tombstones) is exactly the #9 case ("did not edit the
 *     seed") and the engine never pushes it, so there is no race.
 *
 * Best-effort here is a local liveness boundary, not a weaker server invariant.
 * In the normal signed-in UI flow this promotion runs before the first non-demo
 * create, so an account with server notebooks is expected to have had its
 * per-user seed created at least once. If promotion fails and a later create
 * still succeeds (for example, a squatted id or corrupt local storage), that is
 * exceptional drift: fresh-device reconcile will treat the missing seed as
 * deleted, and `features-demo/restore` remains resurrect-only.
 */
export const promoteSeedFloorIfUnsynced = action(async (): Promise<void> => {
  const id = activeNotebookIdAtom()
  if (id === LOCAL_NOTEBOOK_ID) return
  const ownerId = userAtom()?.id
  if (!ownerId) return
  // Already a listed backend row → nothing to promote.
  if (notebookListResource.data().some((it) => it.id === id)) return
  try {
    const sync = await wrap(notebookStorage.getSyncState(id))
    // Only a clean, never-synced seed is promoted here (see doc comment).
    if (sync && (sync.remoteCreated || sync.dirty || sync.deletedCells.length > 0)) return
    const stored = await wrap(notebookStorage.get(id))
    if (!stored) return
    const created = await wrap(
      notebookApi.create({
        id: stored.id,
        title: stored.title,
        formatVersion: stored.formatVersion,
        cells: stored.cells,
      }),
    )
    await wrap(
      notebookStorage.put({ ...created, cells: created.cells.map((cell) => ({ ...cell })) }),
    )
    await wrap(
      notebookStorage.putSyncState({
        notebookId: created.id,
        remoteCreated: true,
        dirty: false,
        deletedCells: [],
        ownerId,
        lastSyncedUpdatedAt: created.updatedAt,
      }),
    )
    notebookListResource.data.set((items) => insertByCreatedAtDesc(items, toListItem(created)))
  } catch (error) {
    console.warn('notebook: failed to promote the local seed before create', error)
  }
}, 'notebook.list.promoteSeedFloor')

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

  // B-1 guard (TARDIS-167 №23): never delete the user's only notebook — that would
  // leave the workspace with nothing open. The sidebar also hides/disables the
  // Delete affordance in this case; this is the model-level backstop so a direct
  // call (or a stray listed row) cannot empty the workspace.
  if (!canDeleteNotebooks()) {
    console.warn('notebook.delete: refusing to delete the only notebook')
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

  // Is this the user's welcome/feature-demo seed? If so, deleting it must leave a
  // durable tombstone (TARDIS-167 №23 contract A) so boot never resurrects it.
  // Resolved before the server call so the 404 (already-deleted) path can tombstone
  // too. Best-effort: a resolution failure (e.g. signed out) must not block delete.
  let isSeed = false
  try {
    isSeed = id === (await wrap(resolveDemoNotebookId()))
  } catch {
    // signed out / id unresolvable — cannot be the per-user seed; leave isSeed=false
  }

  // Optimistically remove the row; a failed DELETE rolls it back (withTransaction).
  notebookListResource.data.set((items) => items.filter((it) => it.id !== id))

  try {
    await wrap(notebookApi.remove(id))
  } catch (error) {
    // A 404 (NOTEBOOK_NOT_FOUND) means the notebook is ALREADY deleted server-side
    // — a stale client (e.g. the seed was deleted on another device). That is not
    // a failure: treat it as a successful delete (idempotent) so the row stays
    // removed and we still tombstone/clean up, instead of showing "Delete failed".
    if (!(error instanceof NotFoundError)) {
      // A real failure (offline/5xx). withTransaction rolls the row back; re-arm
      // the slot we quiesced so the user is left exactly where they were, then
      // re-throw so the dialog surfaces the failure.
      if (wasActive) restoreActiveSlotBindings()
      throw error
    }
    console.info(`notebook.delete: ${id} was already deleted server-side (404); treating as done`)
  }

  // The seed was deleted (by us now, or already gone server-side): record the
  // tombstone so boot does not recreate it. Best-effort — a meta-write hiccup
  // must not roll back a delete that already succeeded.
  if (isSeed) {
    try {
      await wrap(setSeedTombstone())
    } catch (error) {
      console.warn('notebook.delete: failed to record the seed tombstone', error)
    }
  }

  // DELETE committed. From here nothing may throw out of the action, or
  // withTransaction would roll back a delete that already succeeded server-side
  // (H2). Both remaining steps are best-effort.
  if (wasActive) {
    // B-2 (TARDIS-167 №23): the open notebook was deleted, so move the slot to the
    // FIRST remaining row (newest by createdAt — the row was already removed above,
    // so `data()[0]` is the top survivor), instead of resurrecting the welcome
    // seed. Fall back to the seed floor only if nothing remains (B-1 normally
    // prevents deleting the last notebook, but stay defensive). All best-effort
    // (H2): nothing here may reject out of the committed-DELETE transaction.
    const topRemaining = notebookListResource.data().at(0)
    try {
      if (topRemaining) {
        await wrap(openNotebookInSlot(topRemaining.id))
      } else {
        await wrap(settleDeletedSlotToFloor())
      }
    } catch (error) {
      console.error('notebook.delete: settling the slot after delete failed', error)
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
