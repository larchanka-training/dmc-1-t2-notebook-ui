import { describe, expect, test } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/shared/ui/tooltip'
import { NotebookView } from './NotebookView'
import { SEED_CODE } from '../model/notebook'

function renderView() {
  return render(
    <TooltipProvider>
      <NotebookView />
    </TooltipProvider>,
  )
}

function getCellTextareas() {
  return screen.getAllByRole('textbox') as HTMLTextAreaElement[]
}

describe('NotebookView (RTL integration)', () => {
  test('renders a single seed cell on mount', () => {
    renderView()
    const textareas = getCellTextareas()
    expect(textareas).toHaveLength(1)
    expect(textareas[0]).toHaveValue(SEED_CODE)
  })

  test('adding a cell renders one more textarea', async () => {
    const user = userEvent.setup()
    renderView()
    expect(getCellTextareas()).toHaveLength(1)
    await user.click(screen.getAllByRole('button', { name: /add cell/i })[0])
    expect(getCellTextareas()).toHaveLength(2)
  })

  test('running a cell populates its output area', async () => {
    const user = userEvent.setup()
    renderView()
    const [textarea] = getCellTextareas()
    // replace seed code with a deterministic snippet
    await user.clear(textarea)
    await user.type(textarea, 'console.log(1+1)')
    // each cell has a single play button — the first non-toggle button in the cell
    const runButton = screen.getAllByRole('button')[1]
    await act(async () => {
      runButton.click()
    })
    expect(await screen.findByText('2')).toBeInTheDocument()
  })

  test('editing one cell leaves other cells untouched (atomization)', async () => {
    const user = userEvent.setup()
    renderView()
    await user.click(screen.getAllByRole('button', { name: /add cell/i })[0])
    let [first, second] = getCellTextareas()
    expect(first).toHaveValue(SEED_CODE)
    expect(second).toHaveValue('')

    // capture the node identities BEFORE editing
    const firstNode = first
    const secondNode = second

    await user.clear(first)
    await user.type(first, 'console.log("edited")')

    ;[first, second] = getCellTextareas()
    expect(first).toHaveValue('console.log("edited")')
    expect(second).toHaveValue('')
    // same DOM nodes — cell 2 didn't unmount/remount
    expect(first).toBe(firstNode)
    expect(second).toBe(secondNode)
  })
})
