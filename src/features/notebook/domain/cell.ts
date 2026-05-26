import { atom, type Atom } from '@reatom/core'
import type { OutputItem } from '../runtime/types'

export type CellStatus = 'idle' | 'running' | 'done' | 'error'
export type CellKind = 'code' | 'markdown'
export type CellViewMode = 'edit' | 'preview'

export interface Cell {
  id: string
  kind: CellKind
  code: Atom<string>
  output: Atom<OutputItem[]>
  status: Atom<CellStatus>
  viewMode: Atom<CellViewMode>
}

function uid() {
  return Math.random().toString(36).slice(2)
}

export function reatomCell(initialCode = '', kind: CellKind = 'code', id = uid()): Cell {
  return {
    id,
    kind,
    code: atom(initialCode, `notebook.cells#${id}.code`),
    output: atom<OutputItem[]>([], `notebook.cells#${id}.output`),
    status: atom<CellStatus>('idle', `notebook.cells#${id}.status`),
    viewMode: atom<CellViewMode>('edit', `notebook.cells#${id}.viewMode`),
  }
}
