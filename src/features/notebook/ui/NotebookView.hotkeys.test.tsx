import { describe, expect, test } from 'vitest'
import { act, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/shared/ui/tooltip'
import { NotebookView } from './NotebookView'
import { cellsAtom } from '../model/notebook'
import { activeCellIdAtom, cellModeAtom, focusCell } from '../model/cellMode'

function renderView() {
  return render(
    <TooltipProvider>
      <NotebookView />
    </TooltipProvider>,
  )
}

// Put the notebook into command mode on the seed cell, the precondition for
// every command-mode shortcut.
async function focusSeedInCommandMode() {
  const [seed] = cellsAtom()
  await act(async () => focusCell(seed.id))
  return seed
}

describe('command-mode hotkeys', () => {
  test('B inserts a code cell below and focuses it', async () => {
    const user = userEvent.setup()
    renderView()
    const seed = await focusSeedInCommandMode()
    await user.keyboard('b')
    const cells = cellsAtom()
    expect(cells).toHaveLength(2)
    expect(cells[0].id).toBe(seed.id)
    expect(activeCellIdAtom()).toBe(cells[1].id)
  })

  test('A inserts a code cell above', async () => {
    const user = userEvent.setup()
    renderView()
    const seed = await focusSeedInCommandMode()
    await user.keyboard('a')
    const cells = cellsAtom()
    expect(cells).toHaveLength(2)
    expect(cells[1].id).toBe(seed.id)
  })

  test('M and Y switch the active cell kind', async () => {
    const user = userEvent.setup()
    renderView()
    await focusSeedInCommandMode()
    await user.keyboard('m')
    expect(cellsAtom()[0].kind).toBe('markdown')
    await user.keyboard('y')
    expect(cellsAtom()[0].kind).toBe('code')
  })

  test('D D deletes the active cell', async () => {
    const user = userEvent.setup()
    renderView()
    await focusSeedInCommandMode()
    // add a sibling so deletion is allowed (last cell is protected)
    await user.keyboard('b')
    const beforeIds = cellsAtom().map((c) => c.id)
    await act(async () => focusCell(beforeIds[1]))
    await user.keyboard('dd')
    const afterIds = cellsAtom().map((c) => c.id)
    expect(afterIds).toHaveLength(1)
    expect(afterIds).not.toContain(beforeIds[1])
  })

  test('a single D does not delete', async () => {
    const user = userEvent.setup()
    renderView()
    await focusSeedInCommandMode()
    await user.keyboard('b')
    await act(async () => focusCell(cellsAtom()[1].id))
    await user.keyboard('d')
    expect(cellsAtom()).toHaveLength(2)
  })

  test('arrows move focus between cells', async () => {
    const user = userEvent.setup()
    renderView()
    const seed = await focusSeedInCommandMode()
    await user.keyboard('b')
    const [, second] = cellsAtom()
    // focus is on the new second cell; ArrowUp should go back to the seed
    await act(async () => focusCell(second.id))
    await user.keyboard('{ArrowUp}')
    expect(activeCellIdAtom()).toBe(seed.id)
    await user.keyboard('{ArrowDown}')
    expect(activeCellIdAtom()).toBe(second.id)
  })

  test('Enter switches to edit mode', async () => {
    const user = userEvent.setup()
    renderView()
    await focusSeedInCommandMode()
    expect(cellModeAtom()).toBe('command')
    await user.keyboard('{Enter}')
    expect(cellModeAtom()).toBe('edit')
  })
})
