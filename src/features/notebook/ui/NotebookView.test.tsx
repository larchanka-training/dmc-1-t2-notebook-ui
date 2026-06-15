import { describe, expect, test } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { TooltipProvider } from '@/shared/ui/tooltip'
import { NotebookView } from './NotebookView'
import { cellsAtom, SEED_CODE, updateCellCode } from '../model/notebook'
import { slotOpeningPhaseAtom } from '../model/slot'

function renderView() {
  return render(
    <TooltipProvider>
      <NotebookView />
    </TooltipProvider>,
  )
}

// Code cells render as CodeMirror editors (contenteditable .cm-content), not
// <textarea>. We count the editor hosts and read their text content. Driving
// keystrokes into CM under JSDOM is unreliable (it needs layout geometry), so
// text edits in these integration tests go through the model action.
function getCodeEditors() {
  return Array.from(document.querySelectorAll('.cm-content')) as HTMLElement[]
}

async function addCodeCell(user: UserEvent) {
  // The inserter renders direct "Code" / "Text" pills (no overflow menu). The
  // end-of-notebook strip is always present; click its "Code" pill (the last
  // one, since between-cell gutters also expose a "Code" pill).
  const codeButtons = screen.getAllByRole('button', { name: /^code$/i })
  await user.click(codeButtons[codeButtons.length - 1])
}

describe('NotebookView (RTL integration)', () => {
  test('shows notebook loader while opening a server-only notebook', () => {
    act(() => {
      slotOpeningPhaseAtom.set('remote-only')
    })
    const { unmount } = renderView()
    expect(screen.getByRole('status', { name: /loading notebook/i })).toBeInTheDocument()
    expect(screen.getByText(/synchronization/i)).toBeInTheDocument()
    unmount()
    act(() => {
      slotOpeningPhaseAtom.set('idle')
    })
  })

  test('renders a single seed cell on mount', async () => {
    renderView()
    const editors = getCodeEditors()
    expect(editors).toHaveLength(1)
    await waitFor(() => expect(editors[0].textContent).toContain(SEED_CODE))
  })

  test('adding a cell renders one more editor', async () => {
    const user = userEvent.setup()
    renderView()
    // CodeMirror editors mount asynchronously; wait for the seed editor instead of
    // a synchronous assert (which flaked under a busy parallel pool).
    await waitFor(() => expect(getCodeEditors()).toHaveLength(1))
    await addCodeCell(user)
    await waitFor(() => expect(getCodeEditors()).toHaveLength(2))
  })

  test('running a cell populates its output area', async () => {
    const user = userEvent.setup()
    renderView()
    // Set the source through the model, then run via the UI button.
    const [seed] = cellsAtom()
    await act(async () => {
      updateCellCode(seed.id, 'console.log(1+1)')
    })
    await user.click(screen.getByRole('button', { name: /run cell/i }))
    // This is the only test that drives the REAL QuickJS WASM kernel through
    // the UI. Cold WASM init + a busy parallel vitest pool can push the
    // round-trip past RTL's default 1000ms findBy timeout, so wait explicitly.
    expect(await screen.findByText('2', undefined, { timeout: 8000 })).toBeInTheDocument()
  }, 15000)

  test('editing one cell leaves other cells untouched (atomization)', async () => {
    const user = userEvent.setup()
    renderView()
    await waitFor(() => expect(getCodeEditors()).toHaveLength(1))
    await addCodeCell(user)
    const [first, second] = cellsAtom()
    expect(first.code()).toBe(SEED_CODE)
    expect(second.code()).toBe('')

    await act(async () => {
      updateCellCode(first.id, 'console.log("edited")')
    })
    expect(first.code()).toBe('console.log("edited")')
    // sibling untouched
    expect(second.code()).toBe('')
    // same cell identities — no unmount/remount
    const [firstAfter, secondAfter] = cellsAtom()
    expect(firstAfter).toBe(first)
    expect(secondAfter).toBe(second)
  })
})
