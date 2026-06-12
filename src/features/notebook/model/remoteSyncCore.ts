// Pure helpers for the remote autosync engine (#134): the deletedCells tombstone
// lifecycle and mapping the server's LWW-merged response back to NotebookJSON.
// No side effects, no storage or network — so the tricky rules (what to tombstone,
// what to drop after a PATCH, how to accept the merged server doc) are unit-tested
// in isolation, separate from the engine's timers and I/O.

import type { notebook as notebookApi } from '@/shared/api'
import type { CellJSON, NotebookJSON } from '../persistence/schema'
import type { CellTombstoneJSON } from '../persistence/storageAdapter'

/**
 * Cell ids present in `prev` but gone from `current` — i.e. locally deleted since
 * the last check. `changeCellKind` reuses the same cell id, so a kind switch is
 * correctly NOT reported as a removal; only an actual delete drops the id.
 */
export function removedCellIds(prev: Iterable<string>, current: Iterable<string>): string[] {
  const present = new Set(current)
  const out: string[] = []
  for (const id of prev) {
    if (!present.has(id)) out.push(id)
  }
  return out
}

/**
 * Append tombstones for `ids` to `buffer`, de-duplicating by id. An id already in
 * the buffer keeps its earlier `deletedAt` (the original deletion time is the
 * correct LWW basis). Returns the SAME array reference when nothing is added, so
 * the caller can skip a redundant persist with a `===` check.
 */
export function addTombstones(
  buffer: CellTombstoneJSON[],
  ids: string[],
  deletedAt: number,
): CellTombstoneJSON[] {
  if (ids.length === 0) return buffer
  const known = new Set(buffer.map((t) => t.id))
  const additions = ids.filter((id) => !known.has(id)).map((id) => ({ id, deletedAt }))
  return additions.length === 0 ? buffer : [...buffer, ...additions]
}

/**
 * Retract tombstones whose cell id is present again in the current notebook — a
 * delete-then-undo within one unsynced window restores the same cell id, and a
 * `removedCellIds` diff alone never un-marks it. Without this the next PATCH would
 * be self-contradictory (`cells` containing the cell AND a `deletedCells`
 * tombstone for it), and server LWW could delete the restored cell. Returns the
 * SAME array reference when nothing is retracted.
 */
export function retractTombstones(
  buffer: CellTombstoneJSON[],
  presentIds: Iterable<string>,
): CellTombstoneJSON[] {
  const present = new Set(presentIds)
  const next = buffer.filter((t) => !present.has(t.id))
  return next.length === buffer.length ? buffer : next
}

/**
 * Drop the tombstones the server processed in a PATCH — exactly the ids we sent —
 * keeping any added since the request left the client (a delete made while the
 * PATCH was in flight). Implements "remove only server-confirmed tombstones".
 * Returns the SAME array reference when nothing is dropped.
 */
export function dropAckedTombstones(
  buffer: CellTombstoneJSON[],
  sentIds: Iterable<string>,
): CellTombstoneJSON[] {
  const sent = new Set(sentIds)
  const next = buffer.filter((t) => !sent.has(t.id))
  return next.length === buffer.length ? buffer : next
}

/**
 * Map the server's LWW-merged notebook response to the persisted `NotebookJSON`
 * shape (drops `ownerId`, which is not part of the on-disk format). The facade
 * cell shape (`CellSchema`) is already structurally `CellJSON`; we copy the four
 * persisted fields explicitly so an extra wire field can never leak onto disk.
 */
export function serverNotebookToJSON(nb: notebookApi.Notebook): NotebookJSON {
  const cells: CellJSON[] = nb.cells.map((c) => ({
    id: c.id,
    kind: c.kind,
    content: c.content,
    updatedAt: c.updatedAt,
  }))
  return {
    formatVersion: nb.formatVersion,
    id: nb.id,
    title: nb.title,
    createdAt: nb.createdAt,
    updatedAt: nb.updatedAt,
    cells,
  }
}
