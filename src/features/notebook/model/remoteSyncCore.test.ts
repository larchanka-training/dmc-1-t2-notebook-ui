import { describe, expect, test } from 'vitest'
import { notebook as notebookApi } from '@/shared/api'
import { FORMAT_VERSION, isNotebookJSON } from '../persistence/schema'
import type { CellTombstoneJSON } from '../persistence/storageAdapter'
import {
  addTombstones,
  dropAckedTombstones,
  removedCellIds,
  serverNotebookToJSON,
} from './remoteSyncCore'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

describe('removedCellIds', () => {
  test('returns ids present before but gone now', () => {
    expect(removedCellIds([A, B, C], [A, C])).toEqual([B])
  })

  test('returns nothing when the set is unchanged (pure reorder)', () => {
    expect(removedCellIds([A, B], [B, A])).toEqual([])
  })

  test('returns nothing when cells were only added', () => {
    expect(removedCellIds([A], [A, B])).toEqual([])
  })
})

describe('addTombstones', () => {
  test('appends a tombstone for a newly deleted id', () => {
    expect(addTombstones([], [A], 100)).toEqual([{ id: A, deletedAt: 100 }])
  })

  test('does not duplicate an already-tombstoned id and keeps the earlier deletedAt', () => {
    const buffer: CellTombstoneJSON[] = [{ id: A, deletedAt: 100 }]
    const next = addTombstones(buffer, [A], 200)
    expect(next).toBe(buffer) // same reference — nothing added
    expect(next).toEqual([{ id: A, deletedAt: 100 }])
  })

  test('appends only the genuinely new ids', () => {
    const buffer: CellTombstoneJSON[] = [{ id: A, deletedAt: 100 }]
    expect(addTombstones(buffer, [A, B], 200)).toEqual([
      { id: A, deletedAt: 100 },
      { id: B, deletedAt: 200 },
    ])
  })

  test('is a no-op (same reference) for an empty id list', () => {
    const buffer: CellTombstoneJSON[] = [{ id: A, deletedAt: 100 }]
    expect(addTombstones(buffer, [], 200)).toBe(buffer)
  })
})

describe('dropAckedTombstones', () => {
  test('drops exactly the sent ids and keeps the rest', () => {
    const buffer: CellTombstoneJSON[] = [
      { id: A, deletedAt: 100 },
      { id: B, deletedAt: 200 },
    ]
    // B was deleted while the PATCH (carrying only A) was in flight — keep it.
    expect(dropAckedTombstones(buffer, [A])).toEqual([{ id: B, deletedAt: 200 }])
  })

  test('is a no-op (same reference) when nothing sent matches', () => {
    const buffer: CellTombstoneJSON[] = [{ id: A, deletedAt: 100 }]
    expect(dropAckedTombstones(buffer, [B])).toBe(buffer)
  })

  test('clears the buffer when every tombstone was acked', () => {
    const buffer: CellTombstoneJSON[] = [
      { id: A, deletedAt: 100 },
      { id: B, deletedAt: 200 },
    ]
    expect(dropAckedTombstones(buffer, [A, B])).toEqual([])
  })
})

describe('serverNotebookToJSON', () => {
  const serverNotebook: notebookApi.Notebook = {
    id: A,
    title: 'merged',
    ownerId: 'owner-1',
    formatVersion: FORMAT_VERSION,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
    cells: [{ id: B, kind: 'code', content: 'x', updatedAt: 1_700_000_000_500 }],
  }

  test('maps the merged response to a valid NotebookJSON, dropping ownerId', () => {
    const json = serverNotebookToJSON(serverNotebook)
    expect(json).toEqual({
      formatVersion: FORMAT_VERSION,
      id: A,
      title: 'merged',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_001_000,
      cells: [{ id: B, kind: 'code', content: 'x', updatedAt: 1_700_000_000_500 }],
    })
    expect('ownerId' in json).toBe(false)
    expect(isNotebookJSON(json)).toBe(true)
  })

  test('normalizes an empty cell list to a valid notebook', () => {
    const json = serverNotebookToJSON({ ...serverNotebook, cells: [] })
    expect(json.cells).toEqual([])
    expect(isNotebookJSON(json)).toBe(true)
  })
})
