import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RenameNotebookDialog } from './RenameNotebookDialog'
import { LOCAL_NOTEBOOK_ID, notebookTitleAtom, setNotebookTitle } from '../model/notebook'
import { renameTargetAtom } from '../model/notebookSettings'

beforeEach(async () => {
  await act(async () => {
    setNotebookTitle('Original')
    renameTargetAtom.set(null)
  })
})

afterEach(() => {
  cleanup()
})

async function openFor(id: string, title: string) {
  await act(async () => renameTargetAtom.set({ id, title }))
}

describe('RenameNotebookDialog', () => {
  test('is closed (no dialog) when renameTargetAtom is null', () => {
    render(<RenameNotebookDialog />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('opens seeded with the target title', async () => {
    render(<RenameNotebookDialog />)
    await openFor(LOCAL_NOTEBOOK_ID, 'Original')
    const input = await screen.findByLabelText(/notebook name/i)
    expect((input as HTMLInputElement).value).toBe('Original')
  })

  test('Save renames the local notebook and closes', async () => {
    const user = userEvent.setup()
    render(<RenameNotebookDialog />)
    await openFor(LOCAL_NOTEBOOK_ID, 'Original')
    const input = await screen.findByLabelText(/notebook name/i)
    await user.clear(input)
    await user.type(input, 'Renamed from dialog')
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(notebookTitleAtom()).toBe('Renamed from dialog')
    expect(renameTargetAtom()).toBeNull()
  })

  test('Cancel closes without changing the title', async () => {
    const user = userEvent.setup()
    render(<RenameNotebookDialog />)
    await openFor(LOCAL_NOTEBOOK_ID, 'Original')
    const input = await screen.findByLabelText(/notebook name/i)
    await user.clear(input)
    await user.type(input, 'Should not stick')
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(notebookTitleAtom()).toBe('Original')
    expect(renameTargetAtom()).toBeNull()
  })

  test('renaming a backend row does not touch the local title (presentational)', async () => {
    const user = userEvent.setup()
    render(<RenameNotebookDialog />)
    await openFor('backend-nb-1', 'Some backend notebook')
    const input = await screen.findByLabelText(/notebook name/i)
    await user.clear(input)
    await user.type(input, 'Edited backend')
    await user.click(screen.getByRole('button', { name: /save/i }))

    // The open local notebook's title is untouched; the dialog still closes.
    expect(notebookTitleAtom()).toBe('Original')
    expect(renameTargetAtom()).toBeNull()
  })
})
