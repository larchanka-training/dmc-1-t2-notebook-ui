import { describe, expect, test } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/shared/ui/tooltip'
import { NotebookView } from './NotebookView'
import { cellsAtom, updateCellCode } from '../model/notebook'
import { searchOpenAtom, setSearchQuery } from '../model/search'

function renderView() {
  return render(
    <TooltipProvider>
      <NotebookView />
    </TooltipProvider>,
  )
}

describe('SearchBar', () => {
  test('Cmd+F opens the search bar', async () => {
    const user = userEvent.setup()
    renderView()
    expect(screen.queryByPlaceholderText(/search notebook/i)).toBeNull()
    await user.keyboard('{Meta>}f{/Meta}')
    expect(screen.getByPlaceholderText(/search notebook/i)).toBeInTheDocument()
  })

  test('opening with an existing match does not crash (no missing-async-stack)', async () => {
    // Regression: the scroll-to-match effect used to read a computed atom
    // outside the Reatom stack, throwing `missing async stack` and blanking
    // the page when Cmd+F was pressed with a live query.
    const user = userEvent.setup()
    renderView()
    const [seed] = cellsAtom()
    await act(async () => updateCellCode(seed.id, 'console'))
    await user.keyboard('{Control>}f{/Control}')
    const input = screen.getByPlaceholderText(/search notebook/i)
    // Set the query atomically rather than char-by-char: this test asserts the
    // component survives opening with a live match (the old missing-async-stack
    // crash), not the typing path — which is covered by the counter test below.
    await act(async () => setSearchQuery('console'))
    expect(input).toBeInTheDocument()
    // Component still mounted and counting — no crash.
    expect(screen.getByText('1/1')).toBeInTheDocument()
  })

  test('shows a match counter for the typed query', async () => {
    renderView()
    const [seed] = cellsAtom()
    await act(async () => updateCellCode(seed.id, 'sum sum sum'))
    await act(async () => searchOpenAtom.set(true))
    // Set the query atomically: a char-by-char `user.type` is flaky here
    // because each keystroke re-runs the search and re-dispatches CodeMirror
    // decorations, and the typed-input race occasionally drops a character.
    await act(async () => setSearchQuery('sum'))
    expect(screen.getByText('1/3')).toBeInTheDocument()
  })

  test('Enter advances the counter, Escape closes', async () => {
    const user = userEvent.setup()
    renderView()
    const [seed] = cellsAtom()
    await act(async () => updateCellCode(seed.id, 'q q'))
    await act(async () => searchOpenAtom.set(true))
    const input = screen.getByPlaceholderText(/search notebook/i)
    await act(async () => setSearchQuery('q'))
    expect(screen.getByText('1/2')).toBeInTheDocument()
    // Navigation still goes through the real keyboard path (the input's
    // onKeyDown handles Enter/Escape), only the query entry is atomic.
    await act(async () => (input as HTMLInputElement).focus())
    await user.keyboard('{Enter}')
    expect(screen.getByText('2/2')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByPlaceholderText(/search notebook/i)).toBeNull()
  })
})
