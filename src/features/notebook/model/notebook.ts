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

export const updateCellCode = action((id: string, code: string) => {
  const cell = cellsAtom().find((c) => c.id === id)
  cell?.code.set(code)
}, 'notebook.cells.updateCode')
