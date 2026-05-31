import { action, atom } from '@reatom/core'
import { reatomCell, type Cell, type CellKind } from '../domain/cell'

export const SEED_CODE = 'console.log("Hello from JS Notebook!")'

export const cellsAtom = atom<Cell[]>(() => [reatomCell(SEED_CODE)], 'notebook.cells')

export const addCell = action((afterId?: string, kind: CellKind = 'code') => {
  const cell = reatomCell('', kind)
  cellsAtom.set((cells) => {
    if (!afterId) return [...cells, cell]
    const idx = cells.findIndex((c) => c.id === afterId)
    if (idx === -1) return [...cells, cell]
    const next = [...cells]
    next.splice(idx + 1, 0, cell)
    return next
  })
  return cell
}, 'notebook.cells.add')

export const deleteCell = action((id: string) => {
  cellsAtom.set((cells) => (cells.length === 1 ? cells : cells.filter((c) => c.id !== id)))
}, 'notebook.cells.delete')

export const moveCell = action((id: string, dir: -1 | 1) => {
  cellsAtom.set((cells) => {
    const idx = cells.findIndex((c) => c.id === id)
    if (idx === -1) return cells
    const target = idx + dir
    if (target < 0 || target >= cells.length) return cells
    const next = [...cells]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    return next
  })
}, 'notebook.cells.move')

// Index-based reorder used by drag-and-drop, where the drop target is an
// absolute position rather than a single step. `toIndex` is clamped to the
// valid range, so callers can pass an over-/under-shoot without guarding.
export const moveCellTo = action((id: string, toIndex: number) => {
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
}, 'notebook.cells.moveTo')

export const updateCellCode = action((id: string, code: string) => {
  const cell = cellsAtom().find((c) => c.id === id)
  cell?.code.set(code)
}, 'notebook.cells.updateCode')

// Switching kind has to re-create the cell: `kind` is a plain field, not an
// atom, and code<->markdown have different run semantics. We carry over the
// id and the source text, and intentionally drop run state (output, status,
// executionCount) — a markdown cell has no run, and a fresh code cell starts
// unrun. No-op when the kind already matches, so identity is preserved.
export const changeCellKind = action((id: string, kind: CellKind) => {
  const current = cellsAtom().find((c) => c.id === id)
  if (!current || current.kind === kind) return
  const source = current.code()
  cellsAtom.set((cells) => {
    const idx = cells.findIndex((c) => c.id === id)
    if (idx === -1) return cells
    const next = [...cells]
    next[idx] = reatomCell(source, kind, id)
    return next
  })
}, 'notebook.cells.changeKind')
