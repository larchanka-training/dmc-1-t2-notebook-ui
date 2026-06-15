import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError, notebook as notebookApi } from '@/shared/api'
import { notebookStorage } from '../persistence/activeStorage'

// The dialog drives the REAL `deleteNotebookAction` (it now reads the action's
// `.ready()`/`.error()` for pending/error ownership — CL-18), so mock the seams
// the action depends on (server DELETE + local cleanup + slot orchestration), not
// the action itself. The action imports these slot symbols at module load and
// calls `bumpSlotGeneration()` unconditionally, so the mock MUST export every one
// it imports — a stale mock (e.g. only `degradeSlotToFloor`) makes the action
// throw `TypeError` before `notebookApi.remove` and fails the whole suite.
vi.mock('../model/slot', () => ({
  bumpSlotGeneration: vi.fn(),
  quiesceActiveSlot: vi.fn().mockResolvedValue(undefined),
  resetSlotToFloorForAccountChange: vi.fn().mockResolvedValue(undefined),
  restoreActiveSlotBindings: vi.fn(),
  settleDeletedSlotToFloor: vi.fn().mockResolvedValue(undefined),
}))

import { DeleteNotebookDialog } from './DeleteNotebookDialog'
import { deleteTargetAtom } from '../model/notebookSettings'
import { deleteNotebookAction, notebookListResource } from '../model/notebookList'

const TARGET = { id: '55555555-5555-4555-8555-555555555555', title: 'Doomed notebook' }

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.spyOn(notebookStorage, 'delete').mockResolvedValue()
  vi.spyOn(notebookStorage, 'deleteSyncState').mockResolvedValue()
  deleteNotebookAction.error.set(undefined)
  notebookListResource.data.set([])
})

afterEach(() => {
  cleanup()
  act(() => deleteTargetAtom.set(null))
  vi.restoreAllMocks()
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
    const removeSpy = vi.spyOn(notebookApi, 'remove').mockResolvedValue()
    render(<DeleteNotebookDialog />)
    await openFor(TARGET)

    expect(screen.getByText(/Doomed notebook/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^delete$/i }))

    expect(removeSpy).toHaveBeenCalledWith(TARGET.id)
    await waitFor(() => expect(deleteTargetAtom()).toBeNull())
  })

  test('Cancel closes without deleting', async () => {
    const user = userEvent.setup()
    const removeSpy = vi.spyOn(notebookApi, 'remove').mockResolvedValue()
    render(<DeleteNotebookDialog />)
    await openFor(TARGET)

    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(removeSpy).not.toHaveBeenCalled()
    expect(deleteTargetAtom()).toBeNull()
  })

  test('keeps the dialog open and shows pending while the delete is in flight (CL-18)', async () => {
    const user = userEvent.setup()
    const gate = deferred<void>()
    vi.spyOn(notebookApi, 'remove').mockReturnValue(gate.promise)
    render(<DeleteNotebookDialog />)
    await openFor(TARGET)

    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    // While in flight: dialog stays open, the destructive button shows pending.
    await waitFor(() => expect(screen.getByRole('button', { name: /deleting/i })).toBeDisabled())
    expect(deleteTargetAtom()).not.toBeNull()

    await act(async () => {
      gate.resolve()
    })
    await waitFor(() => expect(deleteTargetAtom()).toBeNull())
  })

  test('keeps the dialog open and surfaces an error when the delete fails (CL-18)', async () => {
    const user = userEvent.setup()
    vi.spyOn(notebookApi, 'remove').mockRejectedValue(new ApiError(500, 'boom', 'boom'))
    render(<DeleteNotebookDialog />)
    await openFor(TARGET)

    await user.click(screen.getByRole('button', { name: /^delete$/i }))

    // Failure is surfaced in the dialog, which stays open instead of dropping it.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/delete failed/i))
    expect(deleteTargetAtom()).not.toBeNull()
  })
})
