import { describe, expect, test } from 'vitest'
import { EXPORT_BUNDLE_VERSION, toExportBundle, type NotebookExportBundle } from './exportBundle'
import { HTML_MAX_BYTES, OUTPUT_TOO_LARGE_NAME } from './outputOverlay'
import { FORMAT_VERSION, type NotebookJSON } from './schema'
import type { OutputItem } from '../runtime/types'

const CELL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const notebook = (): NotebookJSON => ({
  formatVersion: FORMAT_VERSION,
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  title: 'NB',
  createdAt: 1,
  updatedAt: 5,
  cells: [{ id: CELL, kind: 'code', content: 'x', updatedAt: 5 }],
})

const build = (items: OutputItem[]): NotebookExportBundle =>
  toExportBundle({
    notebook: notebook(),
    savedAt: 5,
    cells: [{ cellId: CELL, sourceUpdatedAt: 5, items }],
  })

describe('toExportBundle', () => {
  test('wraps NotebookJSON in a versioned envelope with outputs alongside', () => {
    const bundle = build([{ type: 'result', value: { kind: 'primitive', value: 1 } }])
    expect(bundle.exportVersion).toBe(EXPORT_BUNDLE_VERSION)
    expect(bundle.notebook).toEqual(notebook())
    // Rich outputs must NOT be folded into NotebookJSON (the wire contract).
    expect(bundle.notebook).not.toHaveProperty('outputs')
    expect(bundle.outputs[0]!.cellId).toBe(CELL)
    expect(bundle.outputs[0]!.items).toEqual([
      { type: 'result', value: { kind: 'primitive', value: 1 } },
    ])
  })

  test('drops non-persistable items (stdout/stderr/runtime error)', () => {
    const bundle = build([
      { type: 'stdout', text: 'noise' },
      { type: 'error', name: 'TypeError', message: 'boom' },
      { type: 'result', value: { kind: 'primitive', value: true } },
    ])
    expect(bundle.outputs[0]!.items).toEqual([
      { type: 'result', value: { kind: 'primitive', value: true } },
    ])
  })

  test('a cell with no persistable output is omitted entirely', () => {
    const bundle = build([{ type: 'stdout', text: 'only logs' }])
    expect(bundle.outputs).toEqual([])
  })

  test('an over-cap image/html becomes an OutputTooLarge placeholder', () => {
    const bundle = build([{ type: 'html', html: 'z'.repeat(HTML_MAX_BYTES + 1) }])
    const item = bundle.outputs[0]!.items[0]!
    expect(item.type).toBe('error')
    expect(item).toMatchObject({ name: OUTPUT_TOO_LARGE_NAME })
  })

  test('no overflow marker when everything fits', () => {
    const bundle = build([{ type: 'result', value: { kind: 'primitive', value: 1 } }])
    expect(bundle.overflow).toBeNull()
  })

  test('carries the notebook-wide overflow marker instead of dropping cells silently', () => {
    // ~2 MiB image per cell × 20 ≈ 40 MiB > 32 MiB cap → later cells are dropped
    // and counted in a bounded marker (C6.4/C7).
    const twoMiB = 'A'.repeat(2 * 1024 * 1024)
    const bundle = toExportBundle({
      notebook: notebook(),
      savedAt: 5,
      cells: Array.from({ length: 20 }, (_, i) => ({
        cellId: `c${i}`,
        sourceUpdatedAt: 5,
        items: [{ type: 'image', mime: 'image/png', data: twoMiB }] as OutputItem[],
      })),
    })
    expect(bundle.overflow).not.toBeNull()
    expect(bundle.overflow!.droppedCellCount).toBe(20 - bundle.outputs.length)
    expect(bundle.outputs.length).toBeGreaterThan(0)
  })
})
