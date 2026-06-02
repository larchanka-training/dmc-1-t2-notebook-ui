// Pure conversion between the in-memory cell model and the persistent
// NotebookJSON shape. No side effects, no storage access — just data mapping,
// so it is trivially unit-testable and reusable by both the local store and
// the future sync layer.
//
// The one rename that lives here: domain `code` ⇄ persisted `content`. Run
// state (output, status, executionCount) is not serialized; cells restored
// from JSON start unrun.

import { reatomCell, type Cell } from '../domain/cell'
import { FORMAT_VERSION, type CellJSON, type NotebookJSON } from './schema'

/** Metadata that lives on the notebook, not on individual cells. */
export interface NotebookMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

function cellToJSON(cell: Cell): CellJSON {
  return {
    id: cell.id,
    kind: cell.kind,
    content: cell.code(),
    updatedAt: cell.updatedAt(),
  }
}

/** Snapshot the current cell list + notebook metadata into a NotebookJSON. */
export function toJSON(cells: Cell[], meta: NotebookMeta): NotebookJSON {
  return {
    formatVersion: FORMAT_VERSION,
    id: meta.id,
    title: meta.title,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    cells: cells.map(cellToJSON),
  }
}

/** Rebuild live cells from a NotebookJSON. Run state starts empty. */
export function fromJSON(json: NotebookJSON): Cell[] {
  return json.cells.map((cell) => reatomCell(cell.content, cell.kind, cell.id, cell.updatedAt))
}
