import { describe, expect, test } from 'vitest'
import { activeCellIdAtom, cellModeAtom, enterCommand, enterEdit, focusCell } from './cellMode'

describe('cell mode', () => {
  test('defaults to no active cell in command mode', () => {
    expect(activeCellIdAtom()).toBeNull()
    expect(cellModeAtom()).toBe('command')
  })

  test('focusCell activates a cell in command mode', () => {
    focusCell('cell-1')
    expect(activeCellIdAtom()).toBe('cell-1')
    expect(cellModeAtom()).toBe('command')
  })

  test('enterEdit activates a cell in edit mode', () => {
    enterEdit('cell-2')
    expect(activeCellIdAtom()).toBe('cell-2')
    expect(cellModeAtom()).toBe('edit')
  })

  test('enterCommand drops back to command mode, keeping the active cell', () => {
    enterEdit('cell-3')
    enterCommand()
    expect(activeCellIdAtom()).toBe('cell-3')
    expect(cellModeAtom()).toBe('command')
  })

  test('focusCell(null) clears the active cell', () => {
    focusCell('cell-4')
    focusCell(null)
    expect(activeCellIdAtom()).toBeNull()
  })
})
