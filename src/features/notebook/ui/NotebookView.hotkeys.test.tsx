import { describe, expect, test } from 'vitest'
import { act, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/shared/ui/tooltip'
import { NotebookView } from './NotebookView'
import { addCell, cellsAtom } from '../model/notebook'
import { queueAtom } from '../model/runtime'
import { undo } from '../model/history'
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

  test('A is a single undoable action (one undo removes the inserted cell)', async () => {
    const user = userEvent.setup()
    renderView()
    const seed = await focusSeedInCommandMode()
    await user.keyboard('a')
    expect(cellsAtom()).toHaveLength(2)
    // A used to be addCell + moveCellTo (two history steps); now it is one,
    // so a single undo must bring the notebook back to just the seed cell.
    await act(async () => undo())
    const ids = cellsAtom().map((c) => c.id)
    expect(ids).toEqual([seed.id])
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

  test('M does not convert a cell that is queued for Run All', async () => {
    renderView()
    const second = await act(async () => addCell())
    // Simulate the cell sitting in the Run All queue (kind change must be
    // refused so it can't reach the kernel as a now-markdown cell).
    await act(async () => queueAtom.set([second.id]))
    await act(async () => focusCell(second.id))
    const user = userEvent.setup()
    await user.keyboard('m')
    expect(cellsAtom().find((c) => c.id === second.id)?.kind).toBe('code')
    await act(async () => queueAtom.set([]))
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

  test('D on one cell then D on another does not delete (gesture is per-cell)', async () => {
    const user = userEvent.setup()
    renderView()
    await focusSeedInCommandMode()
    await user.keyboard('b')
    const [first, second] = cellsAtom()
    // D on the first cell arms the gesture there...
    await act(async () => focusCell(first.id))
    await user.keyboard('d')
    // ...then focus moves and a second D lands on a DIFFERENT cell: this must
    // re-arm, not confirm — neither cell is deleted.
    await act(async () => focusCell(second.id))
    await user.keyboard('d')
    expect(cellsAtom().map((c) => c.id)).toEqual([first.id, second.id])
  })

  test('D D on the last remaining cell keeps command mode working', async () => {
    const user = userEvent.setup()
    renderView()
    await focusSeedInCommandMode()
    // Single seed cell: D D must NOT delete it (the last cell is protected) and
    // must NOT clear active focus. If focus were cleared, the command-mode
    // scope would unmount and the next shortcut (B) would be silently ignored.
    await user.keyboard('dd')
    expect(cellsAtom()).toHaveLength(1)
    // B still works: a second cell is inserted, proving command mode is alive.
    await user.keyboard('b')
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

  test('clicking inside the editor does not force command mode', async () => {
    const user = userEvent.setup()
    const { container } = renderView()
    // Seed cell is code -> CodeMirror. Clicking into it focuses the editor
    // (edit mode); the row click handler must not override that with command.
    const editor = container.querySelector('.cm-content') as HTMLElement
    await user.click(editor)
    expect(cellModeAtom()).toBe('edit')
  })

  test('clicking the cell shell (outside the editor) enters command mode', async () => {
    const user = userEvent.setup()
    const { container } = renderView()
    const seed = cellsAtom()[0]
    await act(async () => focusCell(seed.id))
    await act(async () => {
      const editor = container.querySelector('.cm-content') as HTMLElement
      editor.focus()
    })
    // Click the row shell (the data-cell-id wrapper), not the editor.
    const shell = container.querySelector(`[data-cell-id="${seed.id}"]`) as HTMLElement
    await user.click(shell)
    expect(cellModeAtom()).toBe('command')
    expect(activeCellIdAtom()).toBe(seed.id)
  })
})

// The `?` hotkey + dialog now live in ShortcutsHelp (mounted globally in
// AppLayout, not inside NotebookView), and are covered in ShortcutsHelp.test.
