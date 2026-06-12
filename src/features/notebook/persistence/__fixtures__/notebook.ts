// Shared notebook fixture for the persistence test suites (adapter contract,
// per-backend, and facade). One builder, one set of constants — so a schema
// change touches a single place instead of every storage test. Test-only; no
// production code imports this.

import { FORMAT_VERSION, type NotebookJSON } from '../schema'

export const CELL_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
export const NOTEBOOK_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
export const NOTEBOOK_ID_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
export const NOTEBOOK_ID_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

export function makeNotebook(id: string, updatedAt: number, title = 'NB'): NotebookJSON {
  return {
    formatVersion: FORMAT_VERSION,
    id,
    title,
    createdAt: 1_700_000_000_000,
    updatedAt,
    cells: [{ id: CELL_ID, kind: 'code', content: 'x', updatedAt }],
  }
}
