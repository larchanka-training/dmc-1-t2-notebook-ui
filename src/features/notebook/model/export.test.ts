import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addCell, cellsAtom, setNotebookTitle, updateCellCode } from './notebook'
import { exportNotebook } from './export'

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
    cell!.output.set([{ type: 'result', value: { kind: 'primitive', value: 42 } }])

    exportNotebook('json')

    const parsed = JSON.parse(await blobText())
    expect(parsed.outputs).toHaveLength(1)
    expect(parsed.outputs[0].cellId).toBe(cell!.id)
    expect(parsed.outputs[0].sourceUpdatedAt).toBe(cell!.updatedAt())
    expect(parsed.outputs[0].items).toEqual([
      { type: 'result', value: { kind: 'primitive', value: 42 } },
    ])
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
    a!.output.set([{ type: 'result', value: { kind: 'primitive', value: 'ok' } }])
    b!.output.set([{ type: 'image', mime: 'image/png', data: 'QUJD' }])
    c!.output.set([{ type: 'html', html: '<b>bold</b>' }])

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
})
