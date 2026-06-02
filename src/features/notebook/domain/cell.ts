import { atom, type Atom } from '@reatom/core'
import { newId } from '@/shared/lib/id'
import type { OutputItem } from '../runtime/types'

export type CellStatus =
  | 'idle'
  | 'running'
  | 'done'
  | 'error'
  | 'interrupted'
  | 'timeout'
  | 'skipped'
export type CellKind = 'code' | 'markdown'
export type CellViewMode = 'edit' | 'preview'

export interface Cell {
  id: string
  kind: CellKind
  code: Atom<string>
  output: Atom<OutputItem[]>
  status: Atom<CellStatus>
  viewMode: Atom<CellViewMode>
  /**
   * Run-counter shown as `[N]` in the cell header. `null` until the cell
   * is run for the first time. Reset to null only by Restart Kernel —
   * editing the code does NOT bump or clear this.
   */
  executionCount: Atom<number | null>
  /**
   * Last content-modification time (Unix ms). Bumped on code/kind edits,
   * NOT on reorder (cell order is a notebook-level concern). Persisted and
   * used as the basis for last-write-wins sync (see api/docs/auth.md §7.2).
   */
  updatedAt: Atom<number>
}

export function reatomCell(
  initialCode = '',
  kind: CellKind = 'code',
  id: string = newId(),
  updatedAt: number = Date.now(),
): Cell {
  return {
    id,
    kind,
    code: atom(initialCode, `notebook.cells#${id}.code`),
    output: atom<OutputItem[]>([], `notebook.cells#${id}.output`),
    status: atom<CellStatus>('idle', `notebook.cells#${id}.status`),
    viewMode: atom<CellViewMode>('edit', `notebook.cells#${id}.viewMode`),
    executionCount: atom<number | null>(null, `notebook.cells#${id}.executionCount`),
    updatedAt: atom<number>(updatedAt, `notebook.cells#${id}.updatedAt`),
  }
}
