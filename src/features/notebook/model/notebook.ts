import { action, atom, wrap } from '@reatom/core'
import * as notebookStorage from '@/shared/lib/storage/notebook'
import { fromJSON, toJSON } from '../persistence/serialize'
import type { NotebookJSON } from '../persistence/schema'
import { reatomCell, type Cell, type CellKind } from '../domain/cell'
import { clearHistory, recordOperation } from './history'

export const SEED_CODE = 'console.log("Hello from JS Notebook!")'

// Single-notebook MVP: the editor owns exactly one notebook with a stable id.
// Multi-notebook (a list, routing by id) is a later epic; until then this
// constant is the persistence key for the one local notebook.
export const LOCAL_NOTEBOOK_ID = '00000000-0000-4000-8000-000000000001'

export const cellsAtom = atom<Cell[]>(() => [reatomCell(SEED_CODE)], 'notebook.cells')

// Notebook-level metadata, separate from the cell list. There is no title UI
// yet, but the persistent format carries these fields (aligned with the
// backend contract), so they live here as the single source the serializer
// and the loader read/write.
export const notebookTitleAtom = atom('Untitled notebook', 'notebook.title')
export const notebookCreatedAtAtom = atom<number>(Date.now(), 'notebook.createdAt')

/** Serialize the current in-memory notebook (cells + metadata) to JSON. */
export function notebookSnapshot(): NotebookJSON {
  return toJSON(cellsAtom(), {
    id: LOCAL_NOTEBOOK_ID,
    title: notebookTitleAtom(),
    createdAt: notebookCreatedAtAtom(),
    updatedAt: Date.now(),
  })
}

/**
 * Load the local notebook from IndexedDB on startup. If a notebook is stored,
 * its cells and metadata replace the in-memory seed; otherwise the seed is
 * persisted as the initial "Welcome" notebook so a reload before any edit
 * still finds it. History is cleared either way — the boot transition is not
 * an undoable user edit. Best-effort: a storage failure leaves the seed in
 * place rather than blocking the editor.
 */
export const loadNotebook = action(async () => {
  let stored: NotebookJSON | undefined
  try {
    stored = await wrap(notebookStorage.get(LOCAL_NOTEBOOK_ID))
  } catch {
    // Corrupt/unreadable storage — fall back to the in-memory seed.
    return
  }

  if (stored) {
    notebookTitleAtom.set(stored.title)
    notebookCreatedAtAtom.set(stored.createdAt)
    cellsAtom.set(fromJSON(stored))
  } else {
    await wrap(notebookStorage.put(notebookSnapshot()))
  }
  clearHistory()
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
