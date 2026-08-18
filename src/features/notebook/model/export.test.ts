import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addCell, cellsAtom, changeCellKind, setNotebookTitle, updateCellCode } from './notebook'
import { exportNotebook } from './export'
import { assertValidIpynbFile } from '../persistence/__fixtures__/nbformatSchema'
import type { Cell } from '../domain/cell'
import type { OutputItem } from '../runtime/types'

// Simulate a completed run: set the visible output AND stamp the version it was
// produced at (what the runtime does), so export treats it as fresh (not stale).
function setFreshOutput(cell: Cell, items: OutputItem[]): void {
  cell.output.set(items)
  cell.outputVersion.set(cell.updatedAt())
}

// jsdom lacks a real Blob.text() and clipboard download surface — we mock the
// browser plumbing (URL + anchor click) and read body bytes back through the
// Blob constructor argument captured by spying on createObjectURL.

describe('exportNotebook', () => {
  let capturedBlob: Blob | null = null
  let capturedFilename = ''

  beforeEach(() => {
    capturedBlob = null
    capturedFilename = ''

    URL.createObjectURL = vi.fn((blob: Blob) => {
      capturedBlob = blob
      return 'blob:mock'
    })
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      capturedFilename = this.download
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function blobText(): Promise<string> {
    expect(capturedBlob).not.toBeNull()
    return await capturedBlob!.text()
  }

  test('JSON export produces a versioned bundle wrapping NotebookJSON', async () => {
    setNotebookTitle('Demo Notebook')
    updateCellCode(cellsAtom()[0]!.id, 'const x = 1')

    exportNotebook('json')

    expect(capturedBlob!.type).toMatch(/^application\/json/)
    const parsed = JSON.parse(await blobText())
    // The bundle envelope — NOT a bare NotebookJSON (which would also be the
    // autosync wire contract). Outputs live alongside, never inside `notebook`.
    expect(parsed.exportVersion).toBe(1)
    expect(parsed.notebook.title).toBe('Demo Notebook')
    expect(parsed.notebook.cells[0].content).toBe('const x = 1')
    expect(parsed.notebook.formatVersion).toBe(1)
    expect(parsed.notebook).not.toHaveProperty('outputs')
    expect(parsed.outputs).toEqual([]) // no cell has output yet
  })

  test('JSON bundle carries rich cell outputs (projected, capped)', async () => {
    setNotebookTitle('With outputs')
    const [cell] = cellsAtom()
    updateCellCode(cell!.id, 'display("hi")')
    setFreshOutput(cell!, [{ type: 'result', value: { kind: 'primitive', value: 42 } }])

    exportNotebook('json')

    const parsed = JSON.parse(await blobText())
    expect(parsed.outputs).toHaveLength(1)
    expect(parsed.outputs[0].cellId).toBe(cell!.id)
    expect(parsed.outputs[0].sourceUpdatedAt).toBe(cell!.updatedAt())
    expect(parsed.outputs[0].items).toEqual([
      { type: 'result', value: { kind: 'primitive', value: 42 } },
    ])
  })

  test('Jupyter export produces a parseable nbformat 4.5 document with outputs', async () => {
    setNotebookTitle('NB Doc')
    const [cell] = cellsAtom()
    updateCellCode(cell!.id, 'display("hi")')
    setFreshOutput(cell!, [{ type: 'image', mime: 'image/png', data: 'QUJD' }])

    exportNotebook('ipynb')

    expect(capturedBlob!.type).toMatch(/^application\/x-ipynb\+json/)
    const nb = JSON.parse(await blobText())
    expect(nb.nbformat).toBe(4)
    expect(nb.nbformat_minor).toBe(5)
    expect(nb.cells[0].cell_type).toBe('code')
    expect(nb.cells[0].id).toBe(cell!.id) // nbformat 4.5 requires a cell id
    expect(nb.cells[0].outputs[0]).toEqual({
      output_type: 'display_data',
      data: { 'image/png': 'QUJD' },
      metadata: {},
    })
  })

  test('Markdown export wraps code cells in a javascript fence', async () => {
    setNotebookTitle('MD Doc')
    addCell()
    const [first, second] = cellsAtom()
    updateCellCode(first!.id, 'console.log(1)')
    updateCellCode(second!.id, 'console.log(2)')

    exportNotebook('markdown')

    expect(capturedBlob!.type).toMatch(/^text\/markdown/)
    const text = await blobText()
    expect(text.startsWith('# MD Doc\n')).toBe(true)
    expect(text).toContain('```javascript\nconsole.log(1)\n```')
    expect(text).toContain('```javascript\nconsole.log(2)\n```')
  })

  test('uses sanitized title + extension as the download filename', () => {
    setNotebookTitle('Hello / World!')

    exportNotebook('json')
    expect(capturedFilename).toBe('Hello-World.json')

    exportNotebook('markdown')
    expect(capturedFilename).toBe('Hello-World.md')

    exportNotebook('ipynb')
    expect(capturedFilename).toBe('Hello-World.ipynb')
  })

  test('JSON export updatedAt is deterministic across consecutive clicks (no Date.now drift)', async () => {
    setNotebookTitle('Stable')
    updateCellCode(cellsAtom()[0]!.id, 'const x = 1')

    exportNotebook('json')
    const first = JSON.parse(await blobText()).notebook.updatedAt as number

    // Advance wall-clock far past any plausible debounce; the export must
    // still report the same updatedAt because no content actually changed.
    await new Promise((r) => setTimeout(r, 5))

    exportNotebook('json')
    const second = JSON.parse(await blobText()).notebook.updatedAt as number

    expect(second).toBe(first)
  })

  test('Markdown export renders result / image / inert-html outputs (C3)', async () => {
    setNotebookTitle('Rich MD')
    const [a] = cellsAtom()
    const b = addCell()
    const c = addCell()
    updateCellCode(a!.id, 'r()')
    updateCellCode(b!.id, 'img()')
    updateCellCode(c!.id, 'html()')
    setFreshOutput(a!, [{ type: 'result', value: { kind: 'primitive', value: 'ok' } }])
    setFreshOutput(b!, [{ type: 'image', mime: 'image/png', data: 'QUJD' }])
    setFreshOutput(c!, [{ type: 'html', html: '<b>bold</b>' }])

    exportNotebook('markdown')
    const text = await blobText()

    // result → fenced code block of the rendered value
    expect(text).toContain('```\n"ok"\n```')
    // image → bounded data-URI
    expect(text).toContain('![output](data:image/png;base64,QUJD)')
    // html → INERT: fenced `html` source, never a live/raw block
    expect(text).toContain('```html\n<b>bold</b>\n```')
    expect(text).not.toContain('\n<b>bold</b>\n\n') // not emitted as raw markup
  })

  test('Markdown export omits output blocks for cells with no output', async () => {
    setNotebookTitle('Plain')
    updateCellCode(cellsAtom()[0]!.id, 'const x = 1')

    exportNotebook('markdown')
    const text = await blobText()

    // Just the title + the one code fence, nothing else.
    expect(text).toBe('# Plain\n\n```javascript\nconst x = 1\n```\n')
  })

  test('does NOT export output that is stale after a post-run edit (C6.2)', async () => {
    setNotebookTitle('Stale guard')
    const [cell] = cellsAtom()
    updateCellCode(cell!.id, 'v1()')
    // Run at v1: output produced, stamped with the v1 version.
    setFreshOutput(cell!, [{ type: 'result', value: { kind: 'primitive', value: 'v1-out' } }])
    // Edit to v2 WITHOUT re-running: the old output is still on screen but its
    // version no longer matches the source. (In production the run spans real time
    // so the edit's timestamp is strictly newer; bump explicitly so the test does
    // not depend on `Date.now()` advancing within the same millisecond.)
    updateCellCode(cell!.id, 'v2()')
    cell!.updatedAt.set(cell!.updatedAt() + 1)

    exportNotebook('json')
    const parsed = JSON.parse(await blobText())
    expect(parsed.outputs).toEqual([]) // stale output dropped, not stamped as v2

    exportNotebook('markdown')
    const md = await blobText()
    expect(md).not.toContain('v1-out')
    expect(md).toBe('# Stale guard\n\n```javascript\nv2()\n```\n')
  })

  test('notebook-wide overflow is reported, not silently dropped (JSON + Markdown)', async () => {
    // ~2 MiB image per cell × 20 ≈ 40 MiB > 32 MiB notebook cap, so later cells
    // are dropped and a bounded overflow marker is recorded (C6.4/C7).
    setNotebookTitle('Overflow')
    const twoMiB = 'A'.repeat(2 * 1024 * 1024)
    const cells = [cellsAtom()[0]!]
    for (let i = 1; i < 20; i++) cells.push(addCell())
    for (const cell of cells) {
      updateCellCode(cell.id, 'img()')
      setFreshOutput(cell, [{ type: 'image', mime: 'image/png', data: twoMiB }])
    }

    exportNotebook('json')
    const parsed = JSON.parse(await blobText())
    expect(parsed.overflow).not.toBeNull()
    expect(parsed.overflow.droppedCellCount).toBe(cells.length - parsed.outputs.length)

    exportNotebook('markdown')
    const md = await blobText()
    expect(md).toMatch(/> ⚠️ \d+ cell outputs? omitted: notebook output size limit reached\./)
  }, 15000)
})

// ─── Step 7d — generated-file validation + no-regression ─────────────────────
//
// The tests above assert the mapping; these assert (a) the file a user actually
// downloads satisfies the official nbformat 4.5 schema, and (b) adding the third
// format did not change what JSON and Markdown produce.

describe('exportNotebook — generated-file validation (Step 7d)', () => {
  let capturedBlob: Blob | null = null

  beforeEach(() => {
    capturedBlob = null
    URL.createObjectURL = vi.fn((blob: Blob) => {
      capturedBlob = blob
      return 'blob:mock'
    })
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function exportText(format: 'json' | 'markdown' | 'ipynb'): Promise<string> {
    exportNotebook(format)
    expect(capturedBlob).not.toBeNull()
    return await capturedBlob!.text()
  }

  // A notebook exercising every persisted output kind plus a cell with none, so
  // one fixture covers the whole mapping surface end to end.
  function seedRichNotebook() {
    setNotebookTitle('Validation Doc')
    const [a] = cellsAtom()
    const b = addCell()
    const c = addCell()
    const d = addCell()
    // A real markdown cell, so the .ipynb markdown-cell branch is validated too.
    changeCellKind(a!.id, 'markdown')
    updateCellCode(a!.id, '# Notes\nwith **markdown**')
    updateCellCode(b!.id, 'const answer = 42\nanswer')
    updateCellCode(c!.id, 'img()')
    updateCellCode(d!.id, 'noOutput()')
    setFreshOutput(b!, [{ type: 'result', value: { kind: 'primitive', value: 42 } }])
    setFreshOutput(c!, [
      { type: 'image', mime: 'image/png', data: 'QUJD' },
      { type: 'html', html: '<b>bold</b>' },
    ])
    return { a: a!, b: b!, c: c!, d: d! }
  }

  test('the downloaded .ipynb satisfies the official nbformat 4.5 schema', async () => {
    seedRichNotebook()
    const file = await exportText('ipynb')
    assertValidIpynbFile(file)
    const nb = JSON.parse(file)
    expect(nb.cells.map((cell: { cell_type: string }) => cell.cell_type)).toEqual([
      'markdown',
      'code',
      'code',
      'code',
    ])
  })

  test('an empty, untouched notebook still exports a schema-valid .ipynb', async () => {
    setNotebookTitle('')
    assertValidIpynbFile(await exportText('ipynb'))
  })

  test('JSON export shape is unchanged by the added format', async () => {
    const { b, c, d } = seedRichNotebook()
    const parsed = JSON.parse(await exportText('json'))

    // The envelope and the wire-safe notebook keys — the contract an importer and
    // the autosync payload both depend on (§6 C6.1).
    expect(Object.keys(parsed).sort()).toEqual(['exportVersion', 'notebook', 'outputs', 'overflow'])
    expect(parsed.exportVersion).toBe(1)
    expect(Object.keys(parsed.notebook).sort()).toEqual([
      'cells',
      'createdAt',
      'formatVersion',
      'id',
      'title',
      'updatedAt',
    ])
    expect(parsed.notebook).not.toHaveProperty('outputs')
    // Outputs stay a sibling array, only for cells that have any.
    expect(parsed.outputs.map((o: { cellId: string }) => o.cellId)).toEqual([b.id, c.id])
    expect(parsed.outputs.some((o: { cellId: string }) => o.cellId === d.id)).toBe(false)
    expect(parsed.overflow).toBeNull()
  })

  test('Markdown export output is unchanged by the added format', async () => {
    seedRichNotebook()
    const md = await exportText('markdown')

    expect(md.startsWith('# Validation Doc\n')).toBe(true)
    expect(md).toContain('```javascript\nconst answer = 42\nanswer\n```')
    expect(md).toContain('```\n42\n```')
    expect(md).toContain('![output](data:image/png;base64,QUJD)')
    // html is still INERT in Markdown — the `.ipynb` mapping emits live text/html,
    // and that difference must not leak back into this format.
    expect(md).toContain('```html\n<b>bold</b>\n```')
    expect(md.endsWith('\n')).toBe(true)
  })

  // Markdown carries no cell ids, so attribution has to come from position: slice
  // the document at each cell's own fence and keep everything up to the next one.
  // A whole-document `toContain` would not do — it cannot tell "cell b kept its
  // result" from "some cell somewhere emitted a 42", and `42` already appears in
  // cell b's SOURCE, so such an assertion passes even if every output is dropped.
  function markdownSections(md: string, fences: string[]): string[] {
    const starts = fences.map((fence) => {
      const at = md.indexOf(fence)
      expect(at, `source fence not found in Markdown export: ${fence}`).toBeGreaterThan(-1)
      return { at, end: at + fence.length }
    })
    return starts.map((s, i) => md.slice(s.end, starts[i + 1]?.at ?? md.length))
  }

  test('all three formats carry the same set of output-bearing cells', async () => {
    const { b, c, d } = seedRichNotebook()

    const bundle = JSON.parse(await exportText('json'))
    const jsonCells: string[] = bundle.outputs.map((o: { cellId: string }) => o.cellId)

    const nb = JSON.parse(await exportText('ipynb'))
    const ipynbCells: string[] = nb.cells
      .filter((cell: { outputs?: unknown[] }) => (cell.outputs?.length ?? 0) > 0)
      .map((cell: { id: string }) => cell.id)

    // One shared projection feeds every format, so this must hold by construction —
    // the assertion is what makes a future divergence fail loudly.
    expect(ipynbCells).toEqual(jsonCells)
    expect(jsonCells).toEqual([b.id, c.id])
    const nbCellD = nb.cells.find((cell: { id: string }) => cell.id === d.id)
    expect(nbCellD.outputs).toEqual([])

    // Markdown: assert each output lands under ITS OWN cell, and that the
    // output-less cell contributes source only.
    const md = await exportText('markdown')
    const [sectionB, sectionC, sectionD] = markdownSections(md, [
      '```javascript\nconst answer = 42\nanswer\n```',
      '```javascript\nimg()\n```',
      '```javascript\nnoOutput()\n```',
    ])

    expect(sectionB).toContain('```\n42\n```')
    expect(sectionB).not.toContain('QUJD')

    expect(sectionC).toContain('![output](data:image/png;base64,QUJD)')
    expect(sectionC).toContain('```html\n<b>bold</b>\n```')
    expect(sectionC).not.toContain('```\n42\n```')

    // Nothing but whitespace follows the last cell's fence.
    expect(sectionD!.trim()).toBe('')
  })
})
