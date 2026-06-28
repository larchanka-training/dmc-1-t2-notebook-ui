import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NotebookExportMenu } from './NotebookExportMenu'
import { setNotebookTitle } from '../model/notebook'

// Integration test: click each menu item and assert that the browser-side
// download plumbing (URL.createObjectURL + anchor click) is exercised with a
// Blob whose payload matches the selected format. Mocking only the boundary
// (URL APIs) keeps the rest of the flow real — exportNotebook action,
// notebookSnapshot, serializers, sanitizeFilename, downloadBlob.

describe('NotebookExportMenu', () => {
  let capturedBlob: Blob | null = null
  let capturedFilename = ''

  beforeEach(async () => {
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
    await act(async () => setNotebookTitle('Sample Doc'))
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  test('renders a labelled Download trigger', () => {
    render(<NotebookExportMenu />)
    expect(screen.getByRole('button', { name: /download notebook/i })).toBeInTheDocument()
  })

  test('JSON item produces a parseable application/json Blob', async () => {
    const user = userEvent.setup()
    render(<NotebookExportMenu />)

    await user.click(screen.getByRole('button', { name: /download notebook/i }))
    await user.click(await screen.findByText('JSON'))

    expect(capturedBlob).not.toBeNull()
    expect(capturedBlob!.type).toMatch(/^application\/json/)
    expect(capturedFilename).toBe('Sample-Doc.json')
    const parsed = JSON.parse(await capturedBlob!.text())
    expect(parsed.title).toBe('Sample Doc')
  })

  test('Markdown item produces a text/markdown Blob starting with the title H1', async () => {
    const user = userEvent.setup()
    render(<NotebookExportMenu />)

    await user.click(screen.getByRole('button', { name: /download notebook/i }))
    await user.click(await screen.findByText('Markdown'))

    expect(capturedBlob!.type).toMatch(/^text\/markdown/)
    expect(capturedFilename).toBe('Sample-Doc.md')
    const text = await capturedBlob!.text()
    expect(text.startsWith('# Sample Doc\n')).toBe(true)
  })
})
