import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { peek } from '@reatom/core'
import { act, cleanup, render, screen } from '@testing-library/react'
import { NotebookHeader } from './NotebookHeader'
import {
  activeNotebookIdAtom,
  addCell,
  cellsAtom,
  LOCAL_NOTEBOOK_ID,
  notebookTitleAtom,
  setNotebookTitle,
} from '../model/notebook'
import { notebookListResource } from '../model/notebookList'
import { notebookRevisionAtom } from '../model/revision'

// A list-row helper mirroring the lightweight NotebookListItem shape.
function listRow(id: string, title: string) {
  return { id, title, formatVersion: 1, createdAt: 0, updatedAt: 0, cellsCount: 0 }
}

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
  // Reset cross-test state touched by the live-sync tests below.
  act(() => {
    activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
    notebookListResource.data.set([])
  })
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

  test('a title-only edit bumps the revision so autosave fires', async () => {
    // Regression (pre-existing since TARDIS-74). The title is contenteditable;
    // the browser fires `input` on every keystroke. A title-only edit must still
    // mark the notebook dirty (bump notebookRevisionAtom) on commit — autosave
    // subscribes to that revision, so a missed bump means the edit reaches
    // neither IndexedDB nor the backend. The earlier tests set textContent and
    // blurred WITHOUT firing `input`, so they never exercised the live-sync path
    // that defeated the commit-time bump — that gap is why the bug survived
    // review. This test fires the real `input` event the browser does.
    render(<NotebookHeader />)
    const title = getTitle()
    const revisionBefore = notebookRevisionAtom()

    await act(async () => title.focus())
    title.textContent = 'A title and nothing else'
    await act(async () => title.dispatchEvent(new InputEvent('input', { bubbles: true })))
    await act(async () => title.blur())

    expect(notebookTitleAtom()).toBe('A title and nothing else')
    expect(notebookRevisionAtom()).toBeGreaterThan(revisionBefore)
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

  // The point of TARDIS-167 #2: typing in the header live-patches the sidebar
  // list row for the active notebook (no list refetch). Covered here so a
  // refactor that drops the `renameListItem` call from `onInput` fails (review
  // PR #85 🟡).
  test('input live-patches the active notebook row in the sidebar', async () => {
    const NB = '33333333-3333-4333-8333-333333333333'
    await act(async () => {
      activeNotebookIdAtom.set(NB)
      notebookListResource.data.set([listRow(NB, 'My notebook')])
    })
    render(<NotebookHeader />)
    const title = getTitle()
    await act(async () => title.focus())
    title.textContent = 'Renamed live'
    await act(async () => title.dispatchEvent(new InputEvent('input', { bubbles: true })))

    expect(peek(notebookListResource.data)[0].title).toBe('Renamed live')
  })

  test('Escape rolls back the sidebar row too, not just the DOM/model', async () => {
    const NB = '33333333-3333-4333-8333-333333333333'
    await act(async () => {
      activeNotebookIdAtom.set(NB)
      notebookListResource.data.set([listRow(NB, 'My notebook')])
    })
    render(<NotebookHeader />)
    const title = getTitle()
    await act(async () => title.focus())
    title.textContent = 'Discard me'
    await act(async () => title.dispatchEvent(new InputEvent('input', { bubbles: true })))
    // Mid-edit the row already reflects the live text…
    expect(peek(notebookListResource.data)[0].title).toBe('Discard me')
    await act(async () => {
      title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    // …and Escape restores the row to the pre-edit title.
    expect(peek(notebookListResource.data)[0].title).toBe('My notebook')
  })

  test('clearing the title mid-edit never persists an empty title and keeps the field editable (review PR #85)', async () => {
    render(<NotebookHeader />)
    const title = getTitle()
    await act(async () => title.focus())
    // User selects all and deletes, then pauses — `input` fires with empty text.
    title.textContent = ''
    await act(async () => title.dispatchEvent(new InputEvent('input', { bubbles: true })))

    // The model is NOT set to the empty string the backend rejects — the write is
    // skipped, so the atom keeps its previous non-empty value.
    expect(notebookTitleAtom()).toBe('My notebook')
    // Crucially, the field stays EMPTY (the `[title]` effect must not dump the
    // placeholder back into the contenteditable and jam the caret — the regression
    // this guards). The user can keep typing a fresh title.
    expect(title.textContent).toBe('')

    // Typing a new title now syncs normally.
    title.textContent = 'Fresh name'
    await act(async () => title.dispatchEvent(new InputEvent('input', { bubbles: true })))
    expect(notebookTitleAtom()).toBe('Fresh name')
  })
})
