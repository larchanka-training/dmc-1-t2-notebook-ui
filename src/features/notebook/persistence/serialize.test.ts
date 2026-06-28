import { describe, expect, test } from 'vitest'
import { reatomCell } from '../domain/cell'
import { isNotebookJSON } from './schema'
import { fromJSON, toJSON, toMarkdown, type NotebookMeta } from './serialize'

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
    // schema validation requires UUID ids, so use one here (the mapping tests
    // above keep short ids for readability since the pure mapper doesn't validate).
    const json = toJSON([reatomCell('x', 'code', '22222222-2222-2222-2222-222222222222', 1)], meta)
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

describe('toMarkdown', () => {
  test('renders title as H1 for an empty notebook', () => {
    const md = toMarkdown(toJSON([], meta))
    expect(md).toBe('# My notebook\n')
  })

  test('falls back to Untitled when title is empty', () => {
    const md = toMarkdown(toJSON([], { ...meta, title: '' }))
    expect(md).toBe('# Untitled notebook\n')
  })

  test('emits markdown cells verbatim', () => {
    const json = toJSON(
      [reatomCell('## Section\nbody', 'markdown', '22222222-2222-2222-2222-222222222222', 1)],
      meta,
    )
    expect(toMarkdown(json)).toBe('# My notebook\n\n## Section\nbody\n')
  })

  test('wraps code cells in a javascript fenced block', () => {
    const json = toJSON(
      [reatomCell('const a = 1', 'code', '22222222-2222-2222-2222-222222222222', 1)],
      meta,
    )
    expect(toMarkdown(json)).toBe('# My notebook\n\n```javascript\nconst a = 1\n```\n')
  })

  test('preserves cell order in a mixed notebook', () => {
    const json = toJSON(
      [
        reatomCell('# Intro', 'markdown', '11111111-aaaa-1111-1111-111111111111', 1),
        reatomCell('let x = 2', 'code', '22222222-aaaa-2222-2222-222222222222', 2),
        reatomCell('done', 'markdown', '33333333-aaaa-3333-3333-333333333333', 3),
      ],
      meta,
    )
    expect(toMarkdown(json)).toBe(
      '# My notebook\n\n# Intro\n\n```javascript\nlet x = 2\n```\n\ndone\n',
    )
  })

  test('drops a single trailing newline from code cell content', () => {
    const json = toJSON(
      [reatomCell('a\n', 'code', '44444444-4444-4444-4444-444444444444', 1)],
      meta,
    )
    expect(toMarkdown(json)).toBe('# My notebook\n\n```javascript\na\n```\n')
  })

  test('keeps non-ASCII characters in the title', () => {
    const md = toMarkdown(toJSON([], { ...meta, title: 'Заметка 🚀' }))
    expect(md).toBe('# Заметка 🚀\n')
  })

  test('grows the fence past any backtick run inside a code cell', () => {
    // Code cell contains a ``` sequence (e.g. a literal markdown snippet);
    // a 3-tick fence would close prematurely, so we expect 4 ticks.
    const json = toJSON(
      [
        reatomCell(
          'const md = "```js\\nx\\n```"',
          'code',
          '55555555-5555-5555-5555-555555555555',
          1,
        ),
      ],
      meta,
    )
    expect(toMarkdown(json)).toBe(
      '# My notebook\n\n````javascript\nconst md = "```js\\nx\\n```"\n````\n',
    )
  })

  test('uses 5-tick fence when content contains a 4-tick run', () => {
    const json = toJSON(
      [reatomCell('````', 'code', '66666666-6666-6666-6666-666666666666', 1)],
      meta,
    )
    expect(toMarkdown(json)).toBe('# My notebook\n\n`````javascript\n````\n`````\n')
  })
})
