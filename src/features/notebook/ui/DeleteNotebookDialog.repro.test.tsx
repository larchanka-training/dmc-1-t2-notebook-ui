// Regression (review H1/H2): the delete dialog's `confirm` handler awaits
// `deleteNotebookAction` then writes `deleteTargetAtom` to close. Under production
// `clearStack()` that post-await atom write must run IN-FRAME (`await wrap(...)`);
// a bare `await` drops the async stack and the close throws `missing async stack`
// in the browser, while the empty `catch {}` swallows it and the dialog stays
// open on a committed delete.
//
// The default suite (DeleteNotebookDialog.test.tsx) cannot catch this — it does
// not run under `clearStack()`. This file emulates the production invariant via
// the shared `fireLikeProd` harness (the same approach as slot.repro.test.ts) and
// pins BOTH sides: the fixed `await wrap(...)` pattern survives, and the bare
// `await` pattern throws (so the harness provably catches this bug class).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { context, wrap } from '@reatom/core'
import { fireLikeProd, reseedGlobalStack, settle } from '@/test/clearStack'
import { notebook as notebookApi } from '@/shared/api'
import { notebookStorage } from '../persistence/activeStorage'

// Mock the slot seams the real `deleteNotebookAction` imports (it calls
// `bumpSlotGeneration()` unconditionally) so the action runs without booting the
// real bindings. Keep `deleteNotebookAction` itself real — that is the handler
// whose async-stack survival we are proving.
vi.mock('../model/slot', () => ({
  bumpSlotGeneration: vi.fn(),
  quiesceActiveSlot: vi.fn().mockResolvedValue(undefined),
  resetSlotToFloorForAccountChange: vi.fn().mockResolvedValue(undefined),
  restoreActiveSlotBindings: vi.fn(),
  settleDeletedSlotToFloor: vi.fn().mockResolvedValue(undefined),
}))

import { deleteTargetAtom } from '../model/notebookSettings'
import { deleteNotebookAction, notebookListResource } from '../model/notebookList'

const TARGET = { id: '55555555-5555-4555-8555-555555555555', title: 'Doomed notebook' }

let frame: ReturnType<typeof context.start>

beforeEach(() => {
  frame = context.start()
  frame.run(() => {
    vi.spyOn(notebookStorage, 'delete').mockResolvedValue()
    vi.spyOn(notebookStorage, 'deleteSyncState').mockResolvedValue()
    vi.spyOn(notebookApi, 'remove').mockResolvedValue()
    deleteNotebookAction.error.set(undefined)
    notebookListResource.data.set([])
    deleteTargetAtom.set(TARGET)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  reseedGlobalStack()
})

describe('DeleteNotebookDialog confirm async-stack safety (production clearStack)', () => {
  test('the fixed pattern (await wrap) closes the dialog without throwing', async () => {
    // The dialog's confirm body: await the real action under clearStack with the
    // inner `wrap`, then write the close atom IN-FRAME.
    const confirmFixed = async () => {
      await wrap(deleteNotebookAction(TARGET.id))
      deleteTargetAtom.set(null)
    }

    const threw = await settle(fireLikeProd(frame, confirmFixed))

    expect(threw && String(threw)).toBe(null)
    expect(frame.run(() => deleteTargetAtom())).toBeNull()
  })

  test('the bare-await pattern throws missing async stack (harness catches the bug class)', async () => {
    // Negative control: the pre-fix body (bare `await`) drops the async stack, so
    // the post-await `deleteTargetAtom.set(null)` throws — proving this suite
    // would have caught the H1 regression.
    const confirmBuggy = async () => {
      await deleteNotebookAction(TARGET.id)
      deleteTargetAtom.set(null)
    }

    const threw = await settle(fireLikeProd(frame, confirmBuggy))

    expect(String(threw)).toMatch(/missing async stack/i)
  })
})
