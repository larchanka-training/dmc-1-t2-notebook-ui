import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/shared/ui/tooltip'
import { NotebookView } from './NotebookView'
import { cellsAtom } from '../model/notebook'

// open-into-slot (#135) can load a 0-cell notebook (created via the sidebar "+"),
// and `deleteCell` guards the last cell — so an empty notebook MUST offer a way
// out. This covers the minimal functional empty-state: caption + Code/Text
// inserter that calls addCell with the right kind and leaves the empty state.
function renderView() {
  return render(
    <TooltipProvider>
      <NotebookView />
    </TooltipProvider>,
  )
}

beforeEach(() => {
  act(() => cellsAtom.set([]))
})

afterEach(() => {
  cleanup()
})

describe('NotebookView empty-state (zero cells)', () => {
  test('shows the empty-state caption and add buttons when there are no cells', () => {
    renderView()
    expect(screen.getByText(/this notebook is empty/i)).toBeInTheDocument()
    expect(screen.getByText(/add your first cell to get started/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^code$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^text$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ask/i })).toBeNull()
    expect(screen.getByRole('link', { name: /usage examples/i })).toHaveAttribute('href', '/usage')
  })

  test('clicking "Code" adds a code cell and leaves the empty state', async () => {
    const user = userEvent.setup()
    renderView()
    await user.click(screen.getByRole('button', { name: /^code$/i }))

    expect(cellsAtom()).toHaveLength(1)
    expect(cellsAtom()[0].kind).toBe('code')
    expect(screen.queryByText(/this notebook is empty/i)).toBeNull()
  })

  test('clicking "Text" adds a markdown cell', async () => {
    const user = userEvent.setup()
    renderView()
    await user.click(screen.getByRole('button', { name: /^text$/i }))

    expect(cellsAtom()).toHaveLength(1)
    expect(cellsAtom()[0].kind).toBe('markdown')
  })
})
