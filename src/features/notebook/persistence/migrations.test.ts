import { describe, expect, test } from 'vitest'
import { FORMAT_VERSION } from './schema'
import { applyMigrations } from './migrations'

// A synthetic pre-versioning (v0) document: no `formatVersion`, legacy `code`
// field on cells. The migration must stamp the version and rename code→content.
function v0Notebook() {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    title: 'Legacy',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    cells: [
      { id: '22222222-2222-2222-2222-222222222222', kind: 'code', code: 'old', updatedAt: 1 },
    ],
  }
}

describe('format migrations', () => {
  test('migrates a v0 document up to the current version', () => {
    const migrated = applyMigrations(v0Notebook())
    expect(migrated.formatVersion).toBe(FORMAT_VERSION)
    expect(migrated.cells[0].content).toBe('old')
    // legacy `code` key is gone after the rename
    expect('code' in migrated.cells[0]).toBe(false)
  })

  test('passes through a current-version document unchanged', () => {
    const current = {
      formatVersion: FORMAT_VERSION,
      id: '11111111-1111-1111-1111-111111111111',
      title: 'Now',
      createdAt: 1,
      updatedAt: 2,
      cells: [
        {
          id: '22222222-2222-2222-2222-222222222222',
          kind: 'markdown',
          content: '# h',
          updatedAt: 3,
        },
      ],
    }
    expect(applyMigrations(current)).toEqual(current)
  })

  test('throws on a version newer than this client understands', () => {
    expect(() => applyMigrations({ ...v0Notebook(), formatVersion: FORMAT_VERSION + 1 })).toThrow(
      /newer format version/,
    )
  })

  test('throws when the migrated shape is still invalid', () => {
    // v0 with a cell missing both `code` and `content` → invalid after migration.
    const broken = { ...v0Notebook(), cells: [{ id: 'x', kind: 'code', updatedAt: 1 }] }
    expect(() => applyMigrations(broken)).toThrow(/Invalid notebook JSON/)
  })

  test('throws on non-object input', () => {
    expect(() => applyMigrations(null)).toThrow(/not an object/)
  })
})
