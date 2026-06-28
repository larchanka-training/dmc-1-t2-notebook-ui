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

  test('JSON export produces a valid NotebookJSON snapshot', async () => {
    setNotebookTitle('Demo Notebook')
    updateCellCode(cellsAtom()[0]!.id, 'const x = 1')

    exportNotebook('json')

    expect(capturedBlob!.type).toMatch(/^application\/json/)
    const parsed = JSON.parse(await blobText())
    expect(parsed.title).toBe('Demo Notebook')
    expect(parsed.cells[0].content).toBe('const x = 1')
    expect(parsed.formatVersion).toBe(1)
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
})
