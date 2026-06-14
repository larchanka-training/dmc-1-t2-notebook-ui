import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// The dialog confirms a delete by calling `deleteNotebookAction` (a named import
// from the list model). Mock that module so the test asserts the dialog wiring,
// not the real optimistic-removal / server-DELETE pipeline.
const listMock = vi.hoisted(() => ({ deleteNotebookAction: vi.fn() }))
vi.mock('../model/notebookList', () => ({ deleteNotebookAction: listMock.deleteNotebookAction }))

import { DeleteNotebookDialog } from './DeleteNotebookDialog'
import { deleteTargetAtom } from '../model/notebookSettings'

const TARGET = { id: '55555555-5555-4555-8555-555555555555', title: 'Doomed notebook' }

beforeEach(() => {
  listMock.deleteNotebookAction.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  act(() => deleteTargetAtom.set(null))
  vi.clearAllMocks()
})

async function openFor(target: typeof TARGET) {
  await act(async () => deleteTargetAtom.set(target))
}

describe('DeleteNotebookDialog', () => {
  test('is closed when deleteTargetAtom is null', () => {
    render(<DeleteNotebookDialog />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('opens with the target title and confirming deletes + closes', async () => {
    const user = userEvent.setup()
    render(<DeleteNotebookDialog />)
    await openFor(TARGET)

    // Title surfaces in the confirmation copy.
    expect(screen.getByText(/Doomed notebook/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /delete/i }))

    expect(listMock.deleteNotebookAction).toHaveBeenCalledWith(TARGET.id)
    expect(deleteTargetAtom()).toBeNull()
  })

  test('Cancel closes without deleting', async () => {
    const user = userEvent.setup()
    render(<DeleteNotebookDialog />)
    await openFor(TARGET)

    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(listMock.deleteNotebookAction).not.toHaveBeenCalled()
    expect(deleteTargetAtom()).toBeNull()
  })
})
