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
})
