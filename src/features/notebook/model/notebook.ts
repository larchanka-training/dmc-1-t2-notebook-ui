import { action, atom, wrap } from '@reatom/core'
import { reatomCell, type Cell, type CellKind } from '../domain/cell'
import { runInWorker } from '../runtime/workerHost'
import type { SharedScope } from '../runtime/types'

export const SEED_CODE = 'console.log("Hello from JS Notebook!")'

export const cellsAtom = atom<Cell[]>(() => [reatomCell(SEED_CODE)], 'notebook.cells')

/**
 * Shared scope carried between cell runs (Jupyter-like). Updated by
 * `runCell` after each successful run. Cleared by Restart Kernel
 * (commit 3).
 */
export const sharedScopeAtom = atom<SharedScope>({}, 'notebook.sharedScope')

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

export const runCell = action(async (id: string) => {
  const cell = cellsAtom().find((c) => c.id === id)
  if (!cell) return
  cell.status.set('running')
  cell.output.set([])
  const code = cell.code()
  const scope = sharedScopeAtom()
  const result = await wrap(runInWorker(code, scope))
  cell.output.set(result.items)
  // Always carry the scope forward (even on error — partial assignments
  // before the throw should still be visible, matching Jupyter).
  sharedScopeAtom.set(result.scope)
  cell.status.set(result.status === 'done' ? 'done' : 'error')
}, 'notebook.cells.run')
