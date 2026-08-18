import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addCell, cellsAtom, setNotebookTitle, updateCellCode } from './notebook'
import { exportNotebook } from './export'
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
