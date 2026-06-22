import { action, atom, wrap } from '@reatom/core'
import { notebookStorage } from '../persistence/activeStorage'
import { NewerFormatError } from '../persistence/migrations'
import { fromJSON, toJSON } from '../persistence/serialize'
import type { NotebookJSON } from '../persistence/schema'
import { reatomCell, type Cell, type CellKind } from '../domain/cell'
import { clearHistory, recordOperation } from './history'
import { bumpNotebookRestored, bumpNotebookRevision } from './revision'
import { DEMO_CELLS, SEED_TITLE } from './featureDemoNotebook'
import { isSeedTombstoned } from './seedTombstone'
import { userAtom } from '@/entities/session'
import { uuidV5 } from '@/shared/lib/id'

// The seed title + cells are authored in ./featureDemoNotebook; SEED_TITLE is
// re-exported here so existing `import { SEED_TITLE } from './notebook'` callers
// keep working unchanged.
export { SEED_TITLE }
export const DEMO_NAMESPACE = '7f3a2b14-9c8d-4e6f-b1a2-c3d4e5f60718'
export const DEMO_NOTEBOOK_ID = 'bf6f2f5d-9d1e-5e9d-a71d-e8247b073860'
export const LOCAL_NOTEBOOK_ID = '00000000-0000-4000-8000-000000000001'

export const LEGACY_LOCAL_NOTEBOOK_ID = LOCAL_NOTEBOOK_ID

/**
 * The feature-demo notebook id for the CURRENT signed-in user, derived
 * deterministically so the frontend seed and the backend restore agree on the
 * SAME id (contract: ui/docs/auth.md §12.1.1; backend api/.../demo.py).
 *
 * JS `uuidV5(name, namespace)` is the REVERSE argument order of Python
 * `uuid5(namespace, name)` — owner id goes first here. The owner id is
 * lowercased to match the backend hashing `str(UUID)`. There is deliberately no
 * pre-sign-in fallback: the legacy floor id must never become a syncable notebook
 * identity.
 */
export async function resolveDemoNotebookId(): Promise<string> {
  const ownerId = userAtom()?.id
  if (!ownerId) {
    throw new Error('Cannot resolve feature-demo notebook id before user hydration')
  }
  return uuidV5(ownerId.toLowerCase(), DEMO_NAMESPACE)
}

// Single-notebook MVP seed id: the deterministic feature-demo notebook. It is no
// longer the *only* id the editor can hold — see `activeNotebookIdAtom` below —
// but it stays the initial value and the persistence key for the local floor.

// The id of the notebook currently loaded in the editor slot (#135). The id is
// not part of the cell/metadata domain state, so before this atom it was always
// *implied* by `LOCAL_NOTEBOOK_ID` and hard-wired into the serializer, the loader
// and the cross-tab filter. Routing every id-dependent binding through this atom
// is what lets the slot switch to a backend notebook (open-into-slot) instead of
// being pinned to one constant. Initial value = `LOCAL_NOTEBOOK_ID`, so until the
// slot actually switches, behaviour is identical to the pre-#135 constant.
export const activeNotebookIdAtom = atom(LOCAL_NOTEBOOK_ID, 'notebook.activeId')

// Initial in-memory editor state = the feature-demo notebook itself, so the
// very first paint already shows the demo content instead of a throwaway
// placeholder cell while `loadNotebook()` resolves IndexedDB asynchronously.
export const cellsAtom = atom<Cell[]>(
  () => fromJSON(freshDemoNotebook(DEMO_NOTEBOOK_ID)),
  'notebook.cells',
)

// Notebook-level metadata, separate from the cell list. There is no title UI
// yet, but the persistent format carries these fields (aligned with the
// backend contract), so they live here as the single source the serializer
// and the loader read/write.
export const notebookTitleAtom = atom(SEED_TITLE, 'notebook.title')
export const notebookCreatedAtAtom = atom<number>(Date.now(), 'notebook.createdAt')

// The `updatedAt` of the stored notebook version this tab is based on. Autosave
// uses it as the compare-and-swap baseline: if IndexedDB contains a newer
// version, this tab must not silently overwrite it. `null` means the tab has no
// trusted persisted baseline yet (e.g. storage failed during boot).
export const notebookBaseUpdatedAtAtom = atom<number | null>(null, 'notebook.baseUpdatedAt')

// Flips to true once the boot-time load has settled (whether it restored a
// stored notebook, seeded a fresh one, or failed and kept the seed). The page
// gates the editor behind this so the user can't type into the seed in the
// brief window before the async IndexedDB read resolves — that input would be
// overwritten by the restored cells. Single-notebook MVP; one boot per session.
export const notebookLoadedAtom = atom(false, 'notebook.loaded')

export type StorageCompatibility = 'ok' | 'newer-format'

// Storage compatibility gate. If IndexedDB contains a notebook created by a
// newer app version, this older client must not write over it. The editor stays
// readable with the in-memory seed, but autosave/overwrite actions are blocked
// until the user opens the notebook in a newer build.
export const storageCompatibilityAtom = atom<StorageCompatibility>(
  'ok',
  'notebook.storageCompatibility',
)

/** Serialize the current in-memory notebook (cells + metadata) to JSON. */
export function notebookSnapshot(): NotebookJSON {
  return toJSON(cellsAtom(), {
    id: activeNotebookIdAtom(),
    title: notebookTitleAtom(),
    createdAt: notebookCreatedAtAtom(),
    updatedAt: Date.now(),
  })
}

// The only sanctioned way to change the notebook title. Title is persisted
// content, so every mutation MUST bump the revision (otherwise a title-only
// edit would not be picked up by autosave). Routing it through one action keeps
// that guarantee in a single place instead of relying on every future caller to
// remember the bump.
export const setNotebookTitle = action((title: string) => {
  if (notebookTitleAtom() === title) return
  notebookTitleAtom.set(title)
  bumpNotebookRevision()
}, 'notebook.setTitle')

/**
 * Reset the in-memory notebook to a fresh single-cell welcome seed (cells +
 * title + createdAt). Used by `loadNotebook` when no stored notebook exists for
 * the active id, so the seed reflects a clean welcome notebook rather than
 * whatever was previously in the editor (e.g. after a slot switch / degrade).
 */
function freshDemoNotebook(demoId: string, now = Date.now()): NotebookJSON {
  return {
    formatVersion: 1,
    id: demoId,
    title: SEED_TITLE,
    createdAt: now,
    updatedAt: now,
    cells: DEMO_CELLS.map((cell) => ({ ...cell, updatedAt: now })),
  }
}

function resetToFreshSeed(demoId: string): void {
  restoreNotebook(freshDemoNotebook(demoId))
}

/**
 * Choose which notebook the editor slot opens on boot (TARDIS-167 №23, contract
 * B / bootstrap step 3). Returns the newest LOCALLY-stored notebook by creation
 * time (newest-first, matching the sidebar's `createdAt desc` order), or
 * `undefined` when nothing is stored locally yet — the caller then falls back to
 * the per-user seed (step 4). Reads through `notebookStorage` so the choice
 * follows the active backend and is unit-testable.
 *
 * `list()` orders by `updatedAt`, but boot must pick by CREATION time so a merely
 * re-opened notebook does not outrank a newer one; we sort explicitly here.
 */
async function pickNewestLocalNotebookId(): Promise<string | undefined> {
  // SAFETY (AGENTS §11, cross-account): IndexedDB is shared by every account on
  // the device and `NotebookJSON` carries no owner, so a bare "newest local"
  // could open another account's notebook under this user. Restrict the choice
  // to notebooks that belong to the CURRENT user, determined deterministically
  // from `user.id`:
  //   • the per-user seed id (`resolveDemoNotebookId`) is derived from `user.id`,
  //     so it is always ours; and
  //   • every other notebook is ours only when its sync-state `ownerId` matches.
  // A notebook with no sync-state and a non-seed id has no provable owner — it is
  // excluded rather than risk a leak.
  const ownerId = userAtom()?.id?.toLowerCase()
  if (!ownerId) return undefined
  const demoId = await wrap(resolveDemoNotebookId())

  const local = await wrap(notebookStorage.list())
  const mine: NotebookJSON[] = []
  for (const nb of local) {
    if (nb.id === demoId) {
      mine.push(nb)
      continue
    }
    const state = await wrap(notebookStorage.getSyncState(nb.id))
    if (state?.ownerId?.toLowerCase() === ownerId) mine.push(nb)
  }
  if (mine.length === 0) return undefined
  // createdAt desc, ties broken by id desc — a deterministic "newest first" that
  // matches the sidebar order.
  const sorted = [...mine].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
  return sorted[0].id
}

async function migrateLegacySeedIfNeeded(demoId: string): Promise<void> {
  const [demo, legacy] = await Promise.all([
    wrap(notebookStorage.get(demoId)),
    wrap(notebookStorage.get(LEGACY_LOCAL_NOTEBOOK_ID)),
  ])
  if (!demo && legacy) {
    const migrated: NotebookJSON = { ...legacy, id: demoId }
    await wrap(notebookStorage.put(migrated))
    const legacyState = await wrap(notebookStorage.getSyncState(LEGACY_LOCAL_NOTEBOOK_ID))
    if (legacyState) {
      await wrap(
        notebookStorage.putSyncState({
          ...legacyState,
          notebookId: demoId,
          remoteCreated: false,
          dirty: true,
          deletedCells: legacyState.deletedCells,
        }),
      )
    }
  }
  await wrap(notebookStorage.delete(LEGACY_LOCAL_NOTEBOOK_ID))
  await wrap(notebookStorage.deleteSyncState(LEGACY_LOCAL_NOTEBOOK_ID))
}

/** Replace the in-memory notebook with a persisted document. */
export const restoreNotebook = action((stored: NotebookJSON) => {
  // Adopt the document's own id as the active slot id. Pre-#135 this was dropped
  // (the id was always the constant); now it is the source the serializer and
  // autosave write under, so loading a backend notebook must point the slot at it.
  activeNotebookIdAtom.set(stored.id)
  notebookTitleAtom.set(stored.title)
  notebookCreatedAtAtom.set(stored.createdAt)
  notebookBaseUpdatedAtAtom.set(stored.updatedAt)
  cellsAtom.set(fromJSON(stored))
  // One bump for the whole restore (cells + title + metadata replaced at once).
  bumpNotebookRevision()
  // Signal a wholesale content replacement so remote-sync re-seeds its
  // delete-detection baseline (the cell set just changed without a user edit).
  bumpNotebookRestored()
  clearHistory()
}, 'notebook.restore')

/**
 * Load the local notebook from the active storage backend on startup. If a
 * notebook is stored, its cells and metadata replace the in-memory seed;
 * otherwise the seed is persisted as the initial "Welcome" notebook so a
 * reload before any edit still finds it.
 *
 * Best-effort by design: ANY storage failure — an unreadable read OR a failed
 * seed write — is swallowed, leaving the in-memory seed in place. The action
 * never rejects, so the caller can unconditionally start autosave afterwards
 * (a later edit will retry the write and surface 'error' via the indicator).
 * History is cleared on every path (success or failure): the boot transition
 * is not an undoable user edit.
 *
 * Returns `true` only when an EXISTING stored notebook was restored, so the
 * caller can show the saved indicator immediately. Seeding a fresh notebook,
 * the newer-format gate, and any storage failure all return `false` (a base
 * timestamp is set after seeding too, so the return value — not the base — is
 * the reliable "was something restored" signal).
 *
 * `pickNewest` (TARDIS-167 №23 bootstrap step 3): only the app-boot caller passes
 * `true`, so when the slot starts on the floor it opens the NEWEST locally-stored
 * notebook (createdAt desc) instead of always the seed. The slot controller's
 * degrade/reset callers pass `false` (the default) — they specifically WANT the
 * seed floor, so they must not be re-routed to some other notebook.
 */
export const loadNotebook = action(async (pickNewest = false) => {
  storageCompatibilityAtom.set('ok')
  let restored = false
  try {
    if (activeNotebookIdAtom() === LOCAL_NOTEBOOK_ID) {
      // Per-user deterministic demo id (matches the backend), so two accounts on
      // the same device never contend for one shared id. `LOCAL_NOTEBOOK_ID` is a
      // legacy lookup key only; if user hydration has not completed yet, fail this
      // boot attempt instead of letting the legacy id leak into autosave/remoteSync.
      const demoId = await wrap(resolveDemoNotebookId())
      // Flip the active id to the per-user demo id BEFORE the (best-effort) legacy
      // migration. If migration threw first, the active id would stay on the legacy
      // floor and the slot would refuse to bind autosave/remote-sync — leaving the
      // editor unsynced for the whole session. Migration is non-critical cleanup,
      // so its failure must never strand the slot on the legacy id.
      activeNotebookIdAtom.set(demoId)
      try {
        await wrap(migrateLegacySeedIfNeeded(demoId))
      } catch (migrationError) {
        console.warn('notebook: legacy seed migration failed; continuing', migrationError)
      }
      // Boot only (step 3): prefer the newest locally-stored notebook over the
      // seed. After a delete the seed may be tombstoned while others remain, so the
      // slot must land on the newest of those. No local notebooks → keep the demo
      // id and fall through to the seed/tombstone branch (step 4). Best-effort.
      if (pickNewest) {
        try {
          const newestLocalId = await wrap(pickNewestLocalNotebookId())
          if (newestLocalId !== undefined) activeNotebookIdAtom.set(newestLocalId)
        } catch (listError) {
          console.warn('notebook: choosing the newest local notebook failed; using seed', listError)
        }
      }
    }
    const stored = await wrap(notebookStorage.get(activeNotebookIdAtom()))
    if (stored) {
      restoreNotebook(stored)
      restored = true
    } else if (await wrap(isSeedTombstoned())) {
      // The user deleted their welcome/feature-demo seed (TARDIS-167 №23 contract
      // A) AND has no other local notebook (step 3 above found none, so the active
      // id is still the demo id). Do NOT recreate the seed: writing a fresh one
      // here is exactly the bug that resurrected a deleted welcome notebook on
      // every boot. Leave the in-memory seed for the brief pre-load paint but
      // persist nothing; server-reconcile (Commit 3b) handles the new-device case.
      notebookBaseUpdatedAtAtom.set(null)
    } else {
      // No stored notebook for the active id. Establish a FRESH welcome seed in
      // memory before snapshotting it: `notebookSnapshot()` serializes the current
      // in-memory cells, which at boot are the seed but after a slot switch /
      // degrade-to-floor are the previously open notebook's cells. Without this
      // reset, degrading the slot to the floor would persist (and keep showing) the
      // deleted notebook's content under LOCAL_NOTEBOOK_ID instead of a clean
      // welcome notebook (caught by the slot CL-9 integration test).
      resetToFreshSeed(activeNotebookIdAtom())
      const seed = notebookSnapshot()
      await wrap(notebookStorage.put(seed))
      notebookBaseUpdatedAtAtom.set(seed.updatedAt)
    }
  } catch (error) {
    if (error instanceof NewerFormatError) {
      storageCompatibilityAtom.set('newer-format')
      notebookBaseUpdatedAtAtom.set(null)
    } else if (error instanceof Error && error.message.includes('user hydration')) {
      activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
      throw error
    }
    // Corrupt/unreadable storage OR a failed seed write — keep the in-memory
    // seed. Never block the editor or autosave startup on storage I/O.
  } finally {
    clearHistory()
    notebookLoadedAtom.set(true)
  }
  return restored
}, 'notebook.load')

// Record a structural change (add/delete/move/change-kind) as a history entry
// by snapshotting the cell array. Undo/redo restore the snapshot directly via
// `cellsAtom.set`, never through these actions, so they don't re-enter the
// stack. Snapshots keep the same Cell instances, so a restored cell brings
// back its code/output/executionCount/updatedAt intact. No-ops (before ===
// after) are not recorded.
function recordStructural(before: Cell[]): void {
  const after = cellsAtom()
  if (before === after) return
  bumpNotebookRevision()
  recordOperation({
    undo: () => cellsAtom.set(before),
    redo: () => cellsAtom.set(after),
  })
}

export const addCell = action((afterId?: string, kind: CellKind = 'code') => {
  const before = cellsAtom()
  const cell = reatomCell('', kind)
  cellsAtom.set((cells) => {
    if (!afterId) return [...cells, cell]
    const idx = cells.findIndex((c) => c.id === afterId)
    if (idx === -1) return [...cells, cell]
    const next = [...cells]
    next.splice(idx + 1, 0, cell)
    return next
  })
  recordStructural(before)
  return cell
}, 'notebook.cells.add')

// Insert a new cell at an absolute index in one shot. Unlike `addCell` (which
// appends or inserts *after* an id), this targets a position directly — needed
// for "insert above" (index 0 included) without a follow-up move. Doing it as a
// single mutation records ONE history entry, so one undo removes the inserted
// cell (a compound add+move would otherwise need two). `index` is clamped to
// `[0, length]`.
export const addCellAt = action((index: number, kind: CellKind = 'code') => {
  const before = cellsAtom()
  const cell = reatomCell('', kind)
  cellsAtom.set((cells) => {
    const at = Math.max(0, Math.min(index, cells.length))
    const next = [...cells]
    next.splice(at, 0, cell)
    return next
  })
  recordStructural(before)
  return cell
}, 'notebook.cells.addAt')

export const deleteCell = action((id: string) => {
  // Refuse to delete a cell that is mid-execution: the running `executeCell`
  // holds this Cell's atoms and would keep writing output/status into a cell
  // that no longer exists, and the kernel would stay 'busy' until timeout with
  // no way to interrupt. Stop the cell first, then delete.
  const target = cellsAtom().find((c) => c.id === id)
  if (target?.status() === 'running') return
  const before = cellsAtom()
  cellsAtom.set((cells) => (cells.length === 1 ? cells : cells.filter((c) => c.id !== id)))
  recordStructural(before)
}, 'notebook.cells.delete')

export const moveCell = action((id: string, dir: -1 | 1) => {
  const before = cellsAtom()
  cellsAtom.set((cells) => {
    const idx = cells.findIndex((c) => c.id === id)
    if (idx === -1) return cells
    const target = idx + dir
    if (target < 0 || target >= cells.length) return cells
    const next = [...cells]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    return next
  })
  recordStructural(before)
}, 'notebook.cells.move')

// Index-based reorder used by drag-and-drop, where the drop target is an
// absolute position rather than a single step. `toIndex` is clamped to the
// valid range, so callers can pass an over-/under-shoot without guarding.
export const moveCellTo = action((id: string, toIndex: number) => {
  const before = cellsAtom()
  cellsAtom.set((cells) => {
    const from = cells.findIndex((c) => c.id === id)
    if (from === -1) return cells
    const to = Math.max(0, Math.min(toIndex, cells.length - 1))
    if (to === from) return cells
    const next = [...cells]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    return next
  })
  recordStructural(before)
}, 'notebook.cells.moveTo')

export const updateCellCode = action((id: string, code: string) => {
  const cell = cellsAtom().find((c) => c.id === id)
  if (!cell) return
  const previous = cell.code()
  if (previous === code) return
  const previousUpdatedAt = cell.updatedAt()
  const now = Date.now()
  cell.code.set(code)
  cell.updatedAt.set(now)
  bumpNotebookRevision()
  // Edits coalesce per cell within the history time window, so a burst of
  // keystrokes collapses into one undo step. Restoring drives the atoms
  // directly (not via this action), so undo/redo don't re-record. The
  // content timestamp is snapshotted both ways so undo/redo stay
  // deterministic (no Date.now() at restore time).
  recordOperation({
    undo: () => {
      cell.code.set(previous)
      cell.updatedAt.set(previousUpdatedAt)
    },
    redo: () => {
      cell.code.set(code)
      cell.updatedAt.set(now)
    },
    coalesceKey: `edit:${id}`,
  })
}, 'notebook.cells.updateCode')

// Switching kind has to re-create the cell: `kind` is a plain field, not an
// atom, and code<->markdown have different run semantics. We carry over the
// id and the source text, and intentionally drop run state (output, status,
// executionCount) — a markdown cell has no run, and a fresh code cell starts
// unrun. No-op when the kind already matches, so identity is preserved.
export const changeCellKind = action((id: string, kind: CellKind) => {
  const current = cellsAtom().find((c) => c.id === id)
  if (!current || current.kind === kind) return
  // Re-creating the Cell while it is executing would orphan the atoms the
  // running `executeCell` still writes to: the new cell would stay idle/empty
  // while the worker finishes into the discarded instance. Block until the run
  // settles (Restart/Stop/normal completion).
  if (current.status() === 'running') return
  const before = cellsAtom()
  const source = current.code()
  cellsAtom.set((cells) => {
    const idx = cells.findIndex((c) => c.id === id)
    if (idx === -1) return cells
    const next = [...cells]
    next[idx] = reatomCell(source, kind, id)
    return next
  })
  recordStructural(before)
}, 'notebook.cells.changeKind')
