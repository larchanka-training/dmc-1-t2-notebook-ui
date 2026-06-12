import { describe, expect, test } from 'vitest'
import { reatomCell } from '../../domain/cell'
import type { OutputItem } from '../../runtime/types'
import {
  CONTEXT_ITEM_SOURCE_CAP,
  buildNotebookContext,
  capContextItems,
  contextToPromptBlock,
  outputsDigest,
  truncateUtf8,
  utf8Length,
} from './contextBuilder'

const code = (src: string, id?: string) => reatomCell(src, 'code', id)
const md = (src: string, id?: string) => reatomCell(src, 'markdown', id)

function contextBytes(items: { source: string }[]): number {
  return items.reduce((sum, item) => sum + utf8Length(item.source), 0)
}

describe('buildNotebookContext', () => {
  test('assembles previous cells old→new with mapped kinds', () => {
    const items = buildNotebookContext([md('# title'), code('const x = 1')], {
      includeGlobals: false,
      includeOutputs: false,
    })
    expect(items).toEqual([
      { kind: 'markdown', source: '# title' },
      { kind: 'code', source: 'const x = 1' },
    ])
  })

  test('beforeCellId restricts to cells above the prompt cell', () => {
    const cells = [code('const a = 1', 'c1'), code('const b = 2', 'c2'), code('PROMPT', 'c3')]
    const items = buildNotebookContext(cells, {
      beforeCellId: 'c3',
      includeGlobals: false,
      includeOutputs: false,
    })
    expect(items.map((i) => i.source)).toEqual(['const a = 1', 'const b = 2'])
  })

  test('includes a globals digest as the first item', () => {
    const items = buildNotebookContext([code('const items = [1, 2, 3]')], {
      includeOutputs: false,
    })
    expect(items[0]).toEqual({ kind: 'globals', source: 'globals: items: array[3]' })
    expect(items[1]).toEqual({ kind: 'code', source: 'const items = [1, 2, 3]' })
  })

  test('includes truncated cell outputs', () => {
    const cell = code('console.log("hi")')
    const output: OutputItem[] = [{ type: 'stdout', text: 'hi\n' }]
    cell.output.set(output)
    const items = buildNotebookContext([cell], { includeGlobals: false })
    expect(items).toContainEqual({ kind: 'output', source: 'hi' })
  })

  test('applies the window to the newest cells', () => {
    const cells = Array.from({ length: 15 }, (_, i) => code(`const v${i} = ${i}`, `c${i}`))
    const items = buildNotebookContext(cells, {
      windowSize: 3,
      includeGlobals: false,
      includeOutputs: false,
    })
    expect(items.map((i) => i.source)).toEqual([
      'const v12 = 12',
      'const v13 = 13',
      'const v14 = 14',
    ])
  })

  test('caps the context to the item ceiling, dropping oldest', () => {
    const cells = Array.from({ length: 20 }, (_, i) => code(`c${i}`, `id${i}`))
    const items = buildNotebookContext(cells, {
      maxItems: 5,
      includeGlobals: false,
      includeOutputs: false,
    })
    expect(items.length).toBeLessThanOrEqual(5)
    // newest survive
    expect(items.at(-1)?.source).toBe('c19')
  })

  test('caps the context to the byte budget, dropping oldest', () => {
    const big = 'x'.repeat(4000)
    const cells = [code(big, 'a'), code(big, 'b'), code(big, 'c')]
    const items = buildNotebookContext(cells, {
      byteCap: 8192,
      includeGlobals: false,
      includeOutputs: false,
    })
    expect(contextBytes(items)).toBeLessThanOrEqual(8192)
    expect(items.at(-1)?.source).toBe(big) // newest kept verbatim
  })

  test('skips empty cells and returns [] for an empty notebook', () => {
    expect(buildNotebookContext([], {})).toEqual([])
    expect(
      buildNotebookContext([code('   ')], { includeGlobals: false, includeOutputs: false }),
    ).toEqual([])
  })
})

describe('outputsDigest', () => {
  test('renders each output kind compactly', () => {
    const digest = outputsDigest([
      { type: 'stdout', text: 'out' },
      { type: 'stderr', text: 'warn' },
      { type: 'error', name: 'TypeError', message: 'boom' },
      { type: 'result', value: { kind: 'array', items: [] } },
    ])
    expect(digest).toContain('out')
    expect(digest).toContain('[stderr] warn')
    expect(digest).toContain('[error] TypeError: boom')
    expect(digest).toContain('[result] array[0]')
  })
})

describe('truncateUtf8', () => {
  test('truncates to the byte budget', () => {
    expect(utf8Length(truncateUtf8('x'.repeat(100), 10))).toBeLessThanOrEqual(10)
    expect(truncateUtf8('short', 100)).toBe('short')
  })

  test('never exceeds the cap on a multi-byte (emoji / CJK) boundary', () => {
    // Each emoji is 4 UTF-8 bytes, each CJK char 3 — caps that fall mid-codepoint
    // must round down, never up (no replacement char inflating the result).
    const emoji = '😀'.repeat(20)
    const cjk = '语言'.repeat(20)
    for (const cap of [1, 2, 3, 4, 5, 7, 10, 11, 30, 41]) {
      expect(utf8Length(truncateUtf8(emoji, cap))).toBeLessThanOrEqual(cap)
      expect(utf8Length(truncateUtf8(cjk, cap))).toBeLessThanOrEqual(cap)
    }
  })
})

describe('capContextItems per-item source cap', () => {
  const cell = (source: string): { kind: 'code'; source: string } => ({ kind: 'code', source })

  test('truncates each item to the per-item source cap (8000), not just the total', () => {
    for (const size of [CONTEXT_ITEM_SOURCE_CAP, CONTEXT_ITEM_SOURCE_CAP + 1, 8192]) {
      const [item] = capContextItems([cell('a'.repeat(size))], 1_000_000, 10)
      expect(utf8Length(item.source)).toBeLessThanOrEqual(CONTEXT_ITEM_SOURCE_CAP)
    }
  })

  test('an item just under the cap is left intact', () => {
    const [item] = capContextItems([cell('a'.repeat(CONTEXT_ITEM_SOURCE_CAP))], 1_000_000, 10)
    expect(item.source.length).toBe(CONTEXT_ITEM_SOURCE_CAP)
  })
})

describe('contextToPromptBlock', () => {
  test('renders a labelled block, empty when no items', () => {
    expect(contextToPromptBlock([])).toBe('')
    const block = contextToPromptBlock([{ kind: 'code', source: 'const x = 1' }])
    expect(block).toContain('Notebook context:')
    expect(block).toContain('// [code]')
    expect(block).toContain('const x = 1')
  })
})
