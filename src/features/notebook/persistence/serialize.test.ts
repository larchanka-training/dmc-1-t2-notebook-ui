import { describe, expect, test } from 'vitest'
import { reatomCell } from '../domain/cell'
import { isNotebookJSON } from './schema'
import { fromJSON, toJSON, type NotebookMeta } from './serialize'

const meta: NotebookMeta = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'My notebook',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_500_000,
}

describe('notebook serialize', () => {
  test('toJSON maps domain `code` to persisted `content`', () => {
    const cell = reatomCell('console.log(1)', 'code', 'c1', 1_700_000_000_001)
    const json = toJSON([cell], meta)
    expect(json.cells[0]).toEqual({
      id: 'c1',
      kind: 'code',
      content: 'console.log(1)',
      updatedAt: 1_700_000_000_001,
    })
  })

  test('toJSON produces schema-valid output', () => {
    const json = toJSON([reatomCell('x', 'code', 'c1', 1)], meta)
    expect(isNotebookJSON(json)).toBe(true)
    expect(json.formatVersion).toBe(1)
  })

  test('toJSON carries notebook metadata', () => {
    const json = toJSON([], meta)
    expect(json).toMatchObject(meta)
    expect(json.cells).toEqual([])
  })

  test('round-trips cells through toJSON → fromJSON', () => {
    const json = toJSON(
      [
        reatomCell('const a = 1', 'code', 'c1', 1_700_000_000_001),
        reatomCell('# Title', 'markdown', 'c2', 1_700_000_000_002),
      ],
      meta,
    )
    const restored = fromJSON(json)
    expect(
      restored.map((c) => ({ id: c.id, kind: c.kind, code: c.code(), at: c.updatedAt() })),
    ).toEqual([
      { id: 'c1', kind: 'code', code: 'const a = 1', at: 1_700_000_000_001 },
      { id: 'c2', kind: 'markdown', code: '# Title', at: 1_700_000_000_002 },
    ])
  })

  test('fromJSON restores cells with empty run state (outputs not persisted)', () => {
    const json = toJSON([reatomCell('code', 'code', 'c1', 1)], meta)
    const [cell] = fromJSON(json)
    expect(cell.output()).toEqual([])
    expect(cell.status()).toBe('idle')
    expect(cell.executionCount()).toBeNull()
  })

  test('serialized JSON has no output/status/executionCount fields', () => {
    const cell = reatomCell('code', 'code', 'c1', 1)
    cell.output.set([{ type: 'stdout', text: 'hi' }])
    cell.executionCount.set(3)
    const json = toJSON([cell], meta)
    const keys = Object.keys(json.cells[0]).sort()
    expect(keys).toEqual(['content', 'id', 'kind', 'updatedAt'])
  })
})
