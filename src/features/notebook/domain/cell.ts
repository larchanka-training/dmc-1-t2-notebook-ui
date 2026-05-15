import { atom, type Atom } from '@reatom/core'

export type CellStatus = 'idle' | 'running' | 'done' | 'error'

export interface Cell {
  id: string
  code: Atom<string>
  output: Atom<string>
  status: Atom<CellStatus>
}

function uid() {
  return Math.random().toString(36).slice(2)
}

export function reatomCell(initialCode = '', id = uid()): Cell {
  return {
    id,
    code: atom(initialCode, `notebook.cells#${id}.code`),
    output: atom('', `notebook.cells#${id}.output`),
    status: atom<CellStatus>('idle', `notebook.cells#${id}.status`),
  }
}
