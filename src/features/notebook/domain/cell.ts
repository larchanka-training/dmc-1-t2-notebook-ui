export type CellStatus = 'idle' | 'running' | 'done' | 'error'

export interface Cell {
  id: string
  code: string
  output: string
  status: CellStatus
}

function uid() {
  return Math.random().toString(36).slice(2)
}

export function makeCell(code = ''): Cell {
  return { id: uid(), code, output: '', status: 'idle' }
}
