import { action, atom } from '@reatom/core'
import { reatomCell, type Cell, type CellKind } from '../domain/cell'
import { recordOperation } from './history'

export const SEED_CODE = 'console.log("Hello from JS Notebook!")'

export const cellsAtom = atom<Cell[]>(() => [reatomCell(SEED_CODE)], 'notebook.cells')

// Record a structural change (add/delete/move/change-kind) as a history entry
// by snapshotting the cell array. Undo/redo restore the snapshot directly via
// `cellsAtom.set`, never through these actions, so they don't re-enter the
// stack. Snapshots keep the same Cell instances, so a restored cell brings
// back its code/output/executionCount intact. No-ops (before === after) are
// not recorded.
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

export const deleteCell = action((id: string) => {
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
  cell.code.set(code)
  // Edits coalesce per cell within the history time window, so a burst of
  // keystrokes collapses into one undo step. Restoring drives the code atom
  // directly (not via this action), so undo/redo don't re-record.
  recordOperation({
    undo: () => cell.code.set(previous),
    redo: () => cell.code.set(code),
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
