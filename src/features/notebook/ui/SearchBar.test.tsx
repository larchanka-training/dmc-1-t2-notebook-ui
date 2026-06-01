import { describe, expect, test } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/shared/ui/tooltip'
import { NotebookView } from './NotebookView'
import { cellsAtom, updateCellCode } from '../model/notebook'
import { searchOpenAtom } from '../model/search'

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

  test('shows a match counter for the typed query', async () => {
    const user = userEvent.setup()
    renderView()
    const [seed] = cellsAtom()
    await act(async () => updateCellCode(seed.id, 'sum sum sum'))
    await act(async () => searchOpenAtom.set(true))
    const input = screen.getByPlaceholderText(/search notebook/i)
    await user.type(input, 'sum')
    expect(screen.getByText('1/3')).toBeInTheDocument()
  })

  test('Enter advances the counter, Escape closes', async () => {
    const user = userEvent.setup()
    renderView()
    const [seed] = cellsAtom()
    await act(async () => updateCellCode(seed.id, 'q q'))
    await act(async () => searchOpenAtom.set(true))
    const input = screen.getByPlaceholderText(/search notebook/i)
    await user.type(input, 'q')
    expect(screen.getByText('1/2')).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(screen.getByText('2/2')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByPlaceholderText(/search notebook/i)).toBeNull()
  })
})
