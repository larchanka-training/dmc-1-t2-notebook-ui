import { describe, expect, test } from 'vitest'
import {
  canRedoAtom,
  canUndoAtom,
  clearHistory,
  recordOperation,
  redo,
  undo,
  type Operation,
} from './history'

// A tiny model under test: a single number we mutate through operations.
function counterOps() {
  const state = { value: 0 }
  const setOp = (from: number, to: number, coalesceKey?: string): Operation => ({
    undo: () => {
      state.value = from
    },
    redo: () => {
      state.value = to
    },
    coalesceKey,
  })
  return { state, setOp }
}

describe('history stack', () => {
  test('undo and redo move through recorded operations', () => {
    const { state, setOp } = counterOps()
    state.value = 1
    recordOperation(setOp(0, 1))
    state.value = 2
    recordOperation(setOp(1, 2))

    expect(canUndoAtom()).toBe(true)
    undo()
    expect(state.value).toBe(1)
    undo()
    expect(state.value).toBe(0)
    expect(canUndoAtom()).toBe(false)

    expect(canRedoAtom()).toBe(true)
    redo()
    expect(state.value).toBe(1)
    redo()
    expect(state.value).toBe(2)
    expect(canRedoAtom()).toBe(false)
  })

  test('recording a new operation clears the redo branch', () => {
    const { setOp } = counterOps()
    recordOperation(setOp(0, 1))
    undo()
    expect(canRedoAtom()).toBe(true)
    recordOperation(setOp(0, 9))
    expect(canRedoAtom()).toBe(false)
  })

  test('caps the stack at 50 operations', () => {
    const { setOp } = counterOps()
    for (let i = 0; i < 60; i++) recordOperation(setOp(i, i + 1))
    let depth = 0
    while (canUndoAtom()) {
      undo()
      depth++
    }
    expect(depth).toBe(50)
  })

  test('coalesces same-key operations within the time window', () => {
    const { state, setOp } = counterOps()
    // Simulate a burst of edits in one cell: 0 -> 1 -> 2 -> 3 within 1s.
    state.value = 1
    recordOperation(setOp(0, 1, 'edit:cell-1'), 1000)
    state.value = 2
    recordOperation(setOp(1, 2, 'edit:cell-1'), 1300)
    state.value = 3
    recordOperation(setOp(2, 3, 'edit:cell-1'), 1600)

    // One undo reverts the whole burst back to the pre-burst value.
    undo()
    expect(state.value).toBe(0)
    expect(canUndoAtom()).toBe(false)
  })

  test('does not coalesce when the window has elapsed', () => {
    const { state, setOp } = counterOps()
    recordOperation(setOp(0, 1, 'edit:cell-1'), 1000)
    recordOperation(setOp(1, 2, 'edit:cell-1'), 3000) // > 1s later
    undo()
    expect(state.value).toBe(1)
  })

  test('clearHistory empties both branches', () => {
    const { setOp } = counterOps()
    recordOperation(setOp(0, 1))
    undo()
    clearHistory()
    expect(canUndoAtom()).toBe(false)
    expect(canRedoAtom()).toBe(false)
  })
})
