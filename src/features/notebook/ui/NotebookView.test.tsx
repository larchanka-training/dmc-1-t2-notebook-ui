import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
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

async function addCodeCell(user: UserEvent) {
  // The "Add cell" trigger at the end of the list opens a menu; pick "Code".
  const triggers = screen.getAllByRole('button', { name: /add cell/i })
  await user.click(triggers[triggers.length - 1])
  const codeItem = await screen.findByRole('menuitem', { name: /code/i })
  await user.click(codeItem)
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
    await addCodeCell(user)
    expect(getCellTextareas()).toHaveLength(2)
  })

  test('running a cell populates its output area', async () => {
    const user = userEvent.setup()
    renderView()
    const [textarea] = getCellTextareas()
    await user.clear(textarea)
    await user.type(textarea, 'console.log(1+1)')
    await user.click(screen.getByRole('button', { name: /run cell/i }))
    // This is the only test that drives the REAL QuickJS WASM kernel through
    // the UI. Cold WASM init + a busy parallel vitest pool can push the
    // round-trip past RTL's default 1000ms findBy timeout (observed ~1.3s),
    // so wait explicitly with a generous budget instead of flaking.
    expect(await screen.findByText('2', undefined, { timeout: 8000 })).toBeInTheDocument()
  }, 15000)

  test('editing one cell leaves other cells untouched (atomization)', async () => {
    const user = userEvent.setup()
    renderView()
    await addCodeCell(user)
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
