// Step 7d — generated-file validation. The 7b unit tests assert our OWN mapping
// (this item becomes that output); these assert the produced file is a valid
// nbformat 4.5 document per the official upstream JSON Schema. The two are
// complementary: the mapping tests would happily agree with each other while both
// drifting away from what Jupyter actually accepts.
//
// Every case validates `JSON.stringify(toIpynb(...))` — the exact bytes the export
// action puts in the Blob.

import { describe, expect, test } from 'vitest'
import { toIpynb } from './ipynb'
import { assertValidIpynbFile } from './__fixtures__/nbformatSchema'
import { toExportBundle, EXPORT_BUNDLE_VERSION, type NotebookExportBundle } from './exportBundle'
import { OUTPUT_TOO_LARGE_NAME } from './outputOverlay'
import { FORMAT_VERSION, type NotebookJSON } from './schema'
import type { OutputItem } from '../runtime/types'

const CODE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const MD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const NB = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

function notebook(cells: NotebookJSON['cells']): NotebookJSON {
  return {
    formatVersion: FORMAT_VERSION,
    id: NB,
    title: 'NB',
    createdAt: 1,
    updatedAt: 5,
    cells,
  }
}

function bundleOf(
  cells: NotebookJSON['cells'],
  outputs: Array<{ cellId: string; items: OutputItem[] }> = [],
): NotebookExportBundle {
  return toExportBundle({
    notebook: notebook(cells),
    savedAt: 5,
    cells: outputs.map((o) => ({ cellId: o.cellId, sourceUpdatedAt: 5, items: o.items })),
  })
}

/** The serialized file, as downloaded. */
function ipynbFile(bundle: NotebookExportBundle): string {
  return JSON.stringify(toIpynb(bundle), null, 2)
}

const codeCell = { id: CODE, kind: 'code' as const, content: 'const x = 1', updatedAt: 5 }
const mdCell = { id: MD, kind: 'markdown' as const, content: '# Title\n\nbody', updatedAt: 5 }

describe('generated .ipynb validates against the official nbformat 4.5 schema', () => {
  test('the validator actually rejects an invalid document (negative control)', () => {
    // Without this, a silently-broken validator would make every test below pass.
    // Drop the 4.5-required cell `id` — the exact regression Step 7b's review caught.
    const nb = toIpynb(bundleOf([codeCell]))
    const broken = JSON.parse(JSON.stringify(nb)) as { cells: Array<Record<string, unknown>> }
    delete broken.cells[0]!.id
    expect(() => assertValidIpynbFile(JSON.stringify(broken))).toThrow(/nbformat 4\.5 schema/)
  })

  test('a notebook with no cells at all', () => {
    assertValidIpynbFile(ipynbFile(bundleOf([])))
  })

  test('markdown + code cells with no outputs', () => {
    assertValidIpynbFile(ipynbFile(bundleOf([mdCell, codeCell])))
  })

  test('an empty cell (source becomes [])', () => {
    assertValidIpynbFile(ipynbFile(bundleOf([{ ...codeCell, content: '' }])))
  })

  test('result output (execute_result / text-plain)', () => {
    const file = ipynbFile(
      bundleOf(
        [codeCell],
        [{ cellId: CODE, items: [{ type: 'result', value: { kind: 'primitive', value: 42 } }] }],
      ),
    )
    assertValidIpynbFile(file)
  })

  test('raster image output (display_data, base64 payload)', () => {
    const file = ipynbFile(
      bundleOf(
        [codeCell],
        [{ cellId: CODE, items: [{ type: 'image', mime: 'image/png', data: 'QUJD' }] }],
      ),
    )
    assertValidIpynbFile(file)
  })

  test('svg image output (decoded to text)', () => {
    const svg = btoa('<svg xmlns="http://www.w3.org/2000/svg"/>')
    const file = ipynbFile(
      bundleOf(
        [codeCell],
        [{ cellId: CODE, items: [{ type: 'image', mime: 'image/svg+xml', data: svg }] }],
      ),
    )
    assertValidIpynbFile(file)
  })

  test('malformed svg degrades to a stream output and stays valid', () => {
    const file = ipynbFile(
      bundleOf(
        [codeCell],
        [{ cellId: CODE, items: [{ type: 'image', mime: 'image/svg+xml', data: 'not-base64!!' }] }],
      ),
    )
    assertValidIpynbFile(file)
    expect(file).toContain('"stderr"')
  })

  test('html output (display_data, text-html)', () => {
    const file = ipynbFile(
      bundleOf([codeCell], [{ cellId: CODE, items: [{ type: 'html', html: '<b>hi</b>' }] }]),
    )
    assertValidIpynbFile(file)
  })

  test('multiple outputs on one cell, mixed kinds', () => {
    const file = ipynbFile(
      bundleOf(
        [codeCell],
        [
          {
            cellId: CODE,
            items: [
              { type: 'result', value: { kind: 'primitive', value: 'ok' } },
              { type: 'image', mime: 'image/png', data: 'QUJD' },
              { type: 'html', html: '<i>x</i>' },
            ],
          },
        ],
      ),
    )
    assertValidIpynbFile(file)
  })

  test('OutputTooLarge placeholder (stream/stderr)', () => {
    // Built as a bundle literal: the placeholder is PRODUCED by the projection from
    // an over-cap item, so it cannot be fed in as a live output item.
    const bundle: NotebookExportBundle = {
      exportVersion: EXPORT_BUNDLE_VERSION,
      notebook: notebook([codeCell]),
      outputs: [
        {
          cellId: CODE,
          sourceUpdatedAt: 5,
          savedAt: 5,
          items: [
            { type: 'error', name: OUTPUT_TOO_LARGE_NAME, message: 'Output too large to save.' },
          ],
        },
      ],
      overflow: null,
    }
    assertValidIpynbFile(ipynbFile(bundle))
  })

  test('the synthetic overflow cell carries a schema-valid id', () => {
    // `jsnb-output-overflow` must satisfy the cell-id pattern `^[a-zA-Z0-9-_]+$`.
    const bundle: NotebookExportBundle = {
      ...bundleOf([codeCell]),
      overflow: { droppedCellCount: 3 },
    }
    const file = ipynbFile(bundle)
    assertValidIpynbFile(file)
    expect(file).toContain('jsnb-output-overflow')
  })

  test('unicode content and titles survive serialization', () => {
    const file = ipynbFile(
      bundleOf([
        { ...mdCell, content: '# Заметка 🚀\n' },
        { ...codeCell, content: 'const emoji = "🎉"\nconsole.log(emoji)' },
      ]),
    )
    assertValidIpynbFile(file)
  })
})
