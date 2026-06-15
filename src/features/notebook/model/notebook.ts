import { action, atom, wrap } from '@reatom/core'
import { notebookStorage } from '../persistence/activeStorage'
import { NewerFormatError } from '../persistence/migrations'
import { fromJSON, toJSON } from '../persistence/serialize'
import type { NotebookJSON } from '../persistence/schema'
import { reatomCell, type Cell, type CellKind } from '../domain/cell'
import { clearHistory, recordOperation } from './history'
import { bumpNotebookRestored, bumpNotebookRevision } from './revision'

export const SEED_CODE = 'console.log("Hello from JS Notebook!")'
export const SEED_TITLE = '📓 My first notebook full of features'
export const DEMO_NAMESPACE = '7f3a2b14-9c8d-4e6f-b1a2-c3d4e5f60718'
export const DEMO_NOTEBOOK_ID = 'bf6f2f5d-9d1e-5e9d-a71d-e8247b073860'
export const LOCAL_NOTEBOOK_ID = '00000000-0000-4000-8000-000000000001'

export const LEGACY_LOCAL_NOTEBOOK_ID = LOCAL_NOTEBOOK_ID

const DEMO_CELLS: NotebookJSON['cells'] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'markdown',
    content:
      '# Welcome to JS Notebook\n\nThis feature demo is stored in this browser first. Sign in to sync notebooks to the server; until sync succeeds, local browser storage is the only durable copy.',
    updatedAt: 1,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    kind: 'code',
    content: 'console.log("stdout is grouped")\nconsole.error("stderr stays in order")\n42',
    updatedAt: 1,
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    kind: 'code',
    content:
      'display({ type: "html", value: `<div style="font: 16px system-ui; padding: 12px; border-radius: 12px; background: linear-gradient(135deg, #dbeafe, #f5d0fe);">HTML output runs in a sandboxed iframe.</div>` })',
    updatedAt: 1,
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    kind: 'code',
    content:
      'display({ type: "image", mime: "image/svg+xml", data: btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="120"><rect width="360" height="120" rx="18" fill="#111827"/><text x="24" y="70" fill="#f9fafb" font-size="28" font-family="system-ui">Inline image output</text></svg>`) })',
    updatedAt: 1,
  },
]

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

export const cellsAtom = atom<Cell[]>(() => [reatomCell(SEED_CODE)], 'notebook.cells')

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
function freshDemoNotebook(now = Date.now()): NotebookJSON {
  return {
    formatVersion: 1,
    id: DEMO_NOTEBOOK_ID,
    title: SEED_TITLE,
    createdAt: now,
    updatedAt: now,
    cells: DEMO_CELLS.map((cell) => ({ ...cell, updatedAt: now })),
  }
}

function resetToFreshSeed(): void {
  restoreNotebook(freshDemoNotebook())
}

async function migrateLegacySeedIfNeeded(): Promise<void> {
  const [demo, legacy] = await Promise.all([
    wrap(notebookStorage.get(DEMO_NOTEBOOK_ID)),
    wrap(notebookStorage.get(LEGACY_LOCAL_NOTEBOOK_ID)),
  ])
  if (!demo && legacy) {
    const migrated: NotebookJSON = { ...legacy, id: DEMO_NOTEBOOK_ID }
    await wrap(notebookStorage.put(migrated))
    const legacyState = await wrap(notebookStorage.getSyncState(LEGACY_LOCAL_NOTEBOOK_ID))
    if (legacyState) {
      await wrap(
        notebookStorage.putSyncState({
          ...legacyState,
          notebookId: DEMO_NOTEBOOK_ID,
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
 */
export const loadNotebook = action(async () => {
  storageCompatibilityAtom.set('ok')
  let restored = false
  try {
    if (activeNotebookIdAtom() === LOCAL_NOTEBOOK_ID) {
      await wrap(migrateLegacySeedIfNeeded())
      activeNotebookIdAtom.set(DEMO_NOTEBOOK_ID)
    }
    const stored = await wrap(notebookStorage.get(activeNotebookIdAtom()))
    if (stored) {
      restoreNotebook(stored)
      restored = true
    } else {
      // No stored notebook for the active id. Establish a FRESH welcome seed in
      // memory before snapshotting it: `notebookSnapshot()` serializes the current
      // in-memory cells, which at boot are the seed but after a slot switch /
      // degrade-to-floor are the previously open notebook's cells. Without this
      // reset, degrading the slot to the floor would persist (and keep showing) the
      // deleted notebook's content under LOCAL_NOTEBOOK_ID instead of a clean
      // welcome notebook (caught by the slot CL-9 integration test).
      resetToFreshSeed()
      const seed = notebookSnapshot()
      await wrap(notebookStorage.put(seed))
      notebookBaseUpdatedAtAtom.set(seed.updatedAt)
    }
  } catch (error) {
    if (error instanceof NewerFormatError) {
      storageCompatibilityAtom.set('newer-format')
      notebookBaseUpdatedAtAtom.set(null)
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
