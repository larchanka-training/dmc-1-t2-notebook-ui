import { describe, expect, test } from 'vitest'
import { toIpynb } from './ipynb'
import { toExportBundle, type NotebookExportBundle } from './exportBundle'
import { FORMAT_VERSION, type NotebookJSON } from './schema'
import type { OutputItem } from '../runtime/types'

const CODE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const MD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function notebook(cells: NotebookJSON['cells']): NotebookJSON {
  return {
    formatVersion: FORMAT_VERSION,
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    title: 'NB',
    createdAt: 1,
    updatedAt: 5,
    cells,
  }
}

// Build a bundle the way export does: notebook + live outputs → capped projection.
function bundleOf(
  cells: NotebookJSON['cells'],
  outputs: Array<{ cellId: string; items: OutputItem[] }>,
) {
  return toExportBundle({
    notebook: notebook(cells),
    savedAt: 5,
    cells: outputs.map((o) => ({ cellId: o.cellId, sourceUpdatedAt: 5, items: o.items })),
  })
}

const codeCell = { id: CODE, kind: 'code' as const, content: 'const x = 1', updatedAt: 5 }
const mdCell = { id: MD, kind: 'markdown' as const, content: '# Title', updatedAt: 5 }

describe('toIpynb', () => {
  test('emits a valid nbformat 4.5 envelope with JS kernel metadata', () => {
    const nb = toIpynb(bundleOf([codeCell], []))
    expect(nb.nbformat).toBe(4)
    expect(nb.nbformat_minor).toBe(5)
    expect(nb.metadata.kernelspec).toEqual({ name: 'javascript', display_name: 'JavaScript' })
    expect(nb.metadata.language_info).toEqual({ name: 'javascript' })
  })

  test('maps markdown and code cells in order, source as trailing-newline lines', () => {
    const nb = toIpynb(bundleOf([mdCell, { ...codeCell, content: 'a\nb' }], []))
    expect(nb.cells[0]).toEqual({ cell_type: 'markdown', metadata: {}, source: ['# Title'] })
    expect(nb.cells[1]).toEqual({
      cell_type: 'code',
      metadata: {},
      execution_count: null,
      source: ['a\n', 'b'],
      outputs: [],
    })
  })

  test('result → execute_result with text/plain (same rendering as Markdown)', () => {
    const nb = toIpynb(
      bundleOf(
        [codeCell],
        [{ cellId: CODE, items: [{ type: 'result', value: { kind: 'primitive', value: 42 } }] }],
      ),
    )
    const code = nb.cells[0] as Extract<(typeof nb.cells)[number], { cell_type: 'code' }>
    expect(code.outputs).toEqual([
      {
        output_type: 'execute_result',
        execution_count: null,
        data: { 'text/plain': '42' },
        metadata: {},
      },
    ])
  })

  test('raster image → display_data with the raw base64 under its mime', () => {
    const nb = toIpynb(
      bundleOf(
        [codeCell],
        [{ cellId: CODE, items: [{ type: 'image', mime: 'image/png', data: 'QUJD' }] }],
      ),
    )
    const code = nb.cells[0] as Extract<(typeof nb.cells)[number], { cell_type: 'code' }>
    expect(code.outputs[0]).toEqual({
      output_type: 'display_data',
      data: { 'image/png': 'QUJD' },
      metadata: {},
    })
  })

  test('svg image → display_data with DECODED text under image/svg+xml', () => {
    const svg = '<svg>✓</svg>'
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(svg)))
    const nb = toIpynb(
      bundleOf(
        [codeCell],
        [{ cellId: CODE, items: [{ type: 'image', mime: 'image/svg+xml', data: b64 }] }],
      ),
    )
    const code = nb.cells[0] as Extract<(typeof nb.cells)[number], { cell_type: 'code' }>
    expect(code.outputs[0]).toEqual({
      output_type: 'display_data',
      data: { 'image/svg+xml': svg },
      metadata: {},
    })
  })

  test('html → display_data text/html LIVE (not inert, unlike Markdown export)', () => {
    const nb = toIpynb(
      bundleOf([codeCell], [{ cellId: CODE, items: [{ type: 'html', html: '<b>hi</b>' }] }]),
    )
    const code = nb.cells[0] as Extract<(typeof nb.cells)[number], { cell_type: 'code' }>
    expect(code.outputs[0]).toEqual({
      output_type: 'display_data',
      data: { 'text/html': '<b>hi</b>' },
      metadata: {},
    })
  })

  test('OutputTooLarge → a visible stderr stream, never fabricated data', () => {
    // The placeholder is produced by the projection (cap enforcement), so build the
    // bundle directly to test the .ipynb mapping of that item in isolation.
    const bundle: NotebookExportBundle = {
      exportVersion: 1,
      notebook: notebook([codeCell]),
      outputs: [
        {
          cellId: CODE,
          sourceUpdatedAt: 5,
          savedAt: 5,
          items: [{ type: 'error', name: 'OutputTooLarge', message: 'too big' }],
        },
      ],
      overflow: null,
    }
    const nb = toIpynb(bundle)
    const code = nb.cells[0] as Extract<(typeof nb.cells)[number], { cell_type: 'code' }>
    expect(code.outputs[0]).toEqual({ output_type: 'stream', name: 'stderr', text: 'too big' })
  })

  test('non-persistable output (stdout) never reaches the .ipynb', () => {
    const nb = toIpynb(
      bundleOf([codeCell], [{ cellId: CODE, items: [{ type: 'stdout', text: 'noise' }] }]),
    )
    const code = nb.cells[0] as Extract<(typeof nb.cells)[number], { cell_type: 'code' }>
    expect(code.outputs).toEqual([])
  })

  test('notebook-wide overflow becomes a trailing markdown warning cell', () => {
    const twoMiB = 'A'.repeat(2 * 1024 * 1024)
    const cells = Array.from({ length: 20 }, (_, i) => ({
      id: `1111111${i}-1111-4111-8111-111111111111`.slice(0, 36),
      kind: 'code' as const,
      content: 'img()',
      updatedAt: 5,
    }))
    const nb = toIpynb(
      bundleOf(
        cells,
        cells.map((c) => ({
          cellId: c.id,
          items: [{ type: 'image', mime: 'image/png', data: twoMiB }],
        })),
      ),
    )
    const last = nb.cells[nb.cells.length - 1]
    expect(last.cell_type).toBe('markdown')
    expect((last as { source: string[] }).source[0]).toMatch(
      /⚠️ \d+ cell outputs? omitted: notebook output size limit reached\./,
    )
  })
})
