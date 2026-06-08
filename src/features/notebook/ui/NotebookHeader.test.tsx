import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { NotebookHeader } from './NotebookHeader'
import { addCell, cellsAtom, notebookTitleAtom, setNotebookTitle } from '../model/notebook'

// The title is a contenteditable element. jsdom supports contentEditable and
// textContent, so we drive edits by setting textContent and firing the same
// blur / keydown the component listens for — userEvent.type into contenteditable
// is unreliable across jsdom versions.
function getTitle(): HTMLElement {
  return screen.getByRole('textbox', { name: /notebook title/i })
}

beforeEach(async () => {
  await act(async () => setNotebookTitle('My notebook'))
})

afterEach(() => {
  cleanup()
})

describe('NotebookHeader', () => {
  test('breadcrumb shows the reactive cell count', async () => {
    render(<NotebookHeader />)
    // Seed notebook has one cell.
    expect(screen.getByText('1 cell')).toBeInTheDocument()

    await act(async () => {
      addCell()
    })
    expect(screen.getByText(`${cellsAtom().length} cells`)).toBeInTheDocument()
    expect(cellsAtom().length).toBeGreaterThan(1)
  })

  test('renders the current title from the model', () => {
    render(<NotebookHeader />)
    expect(getTitle().textContent).toBe('My notebook')
  })

  test('Enter commits the edited title to the model and blurs', async () => {
    render(<NotebookHeader />)
    const title = getTitle()
    await act(async () => title.focus())
    title.textContent = 'Renamed via header'
    await act(async () => {
      title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(notebookTitleAtom()).toBe('Renamed via header')
    expect(title).not.toHaveFocus()
  })

  test('blur commits the edited title', async () => {
    render(<NotebookHeader />)
    const title = getTitle()
    await act(async () => title.focus())
    title.textContent = '  Trimmed title  '
    await act(async () => title.blur())
    // Committed value is trimmed.
    expect(notebookTitleAtom()).toBe('Trimmed title')
  })

  test('Escape cancels the edit and restores the committed title', async () => {
    render(<NotebookHeader />)
    const title = getTitle()
    await act(async () => title.focus())
    title.textContent = 'Discard me'
    await act(async () => {
      title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    // Model unchanged; DOM restored to the committed title.
    expect(notebookTitleAtom()).toBe('My notebook')
    expect(title.textContent).toBe('My notebook')
  })

  test('empty title falls back to the placeholder', async () => {
    render(<NotebookHeader />)
    const title = getTitle()
    await act(async () => title.focus())
    title.textContent = '   '
    await act(async () => title.blur())
    expect(notebookTitleAtom()).toBe('Untitled notebook')
  })
})
