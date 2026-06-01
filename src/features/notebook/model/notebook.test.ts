import { describe, expect, test } from 'vitest'
import {
  addCell,
  addCellAt,
  cellsAtom,
  changeCellKind,
  deleteCell,
  moveCell,
  moveCellTo,
  SEED_CODE,
  updateCellCode,
} from './notebook'
import { canRedoAtom, canUndoAtom, redo, undo } from './history'

describe('notebook store', () => {
  test('starts with exactly one seed cell', () => {
    const cells = cellsAtom()
    expect(cells).toHaveLength(1)
    expect(cells[0].code()).toBe(SEED_CODE)
    expect(cells[0].status()).toBe('idle')
    expect(cells[0].output()).toEqual([])
  })

  test('addCell() appends an empty cell to the end', () => {
    const before = cellsAtom()
    addCell()
    const after = cellsAtom()
    expect(after).toHaveLength(before.length + 1)
    expect(after.at(-1)!.code()).toBe('')
    expect(after.at(-1)!.status()).toBe('idle')
    expect(after.at(-1)!.output()).toEqual([])
  })

  test('addCell(afterId) inserts right after the given cell', () => {
    const [first] = cellsAtom()
    const inserted = addCell(first.id)
    addCell() // tail cell
    const order = cellsAtom().map((c) => c.id)
    expect(order.indexOf(inserted.id)).toBe(1)
  })

  test('deleteCell removes the matching cell', () => {
    const inserted = addCell()
    expect(cellsAtom()).toHaveLength(2)
    deleteCell(inserted.id)
    const ids = cellsAtom().map((c) => c.id)
    expect(ids).not.toContain(inserted.id)
    expect(ids).toHaveLength(1)
  })

  test('deleteCell refuses to remove the last remaining cell', () => {
    const [only] = cellsAtom()
    deleteCell(only.id)
    expect(cellsAtom()).toHaveLength(1)
    expect(cellsAtom()[0].id).toBe(only.id)
  })

  test('moveCell swaps with the neighbour', () => {
    const inserted = addCell()
    const before = cellsAtom().map((c) => c.id)
    moveCell(inserted.id, -1)
    const after = cellsAtom().map((c) => c.id)
    expect(after).toEqual([before[1], before[0]])
  })

  test('moveCell is a no-op at the edges', () => {
    const [first] = cellsAtom()
    addCell()
    const before = cellsAtom().map((c) => c.id)
    moveCell(first.id, -1)
    expect(cellsAtom().map((c) => c.id)).toEqual(before)
  })

  test('moveCellTo relocates a cell to an absolute index', () => {
    const a = cellsAtom()[0]
    const b = addCell()
    const c = addCell()
    // order: [a, b, c] -> move c to the front
    moveCellTo(c.id, 0)
    expect(cellsAtom().map((cell) => cell.id)).toEqual([c.id, a.id, b.id])
  })

  test('moveCellTo clamps an out-of-range index', () => {
    const a = cellsAtom()[0]
    const b = addCell()
    moveCellTo(a.id, 99)
    expect(cellsAtom().map((cell) => cell.id)).toEqual([b.id, a.id])
  })

  test('addCellAt inserts at an absolute index (including the front)', () => {
    const a = cellsAtom()[0]
    const inserted = addCellAt(0)
    const ids = cellsAtom().map((c) => c.id)
    expect(ids[0]).toBe(inserted.id)
    expect(ids[1]).toBe(a.id)
  })

  test('addCellAt clamps an out-of-range index to the end', () => {
    const a = cellsAtom()[0]
    const inserted = addCellAt(99)
    expect(cellsAtom().map((c) => c.id)).toEqual([a.id, inserted.id])
  })

  test('addCellAt is a single undoable step', () => {
    const inserted = addCellAt(0)
    expect(cellsAtom().some((c) => c.id === inserted.id)).toBe(true)
    // One undo must fully remove the inserted cell (no leftover move step).
    undo()
    expect(cellsAtom().some((c) => c.id === inserted.id)).toBe(false)
  })

  test('updateCellCode mutates only the targeted cell', () => {
    const a = cellsAtom()[0]
    const b = addCell()
    const aCodeAtom = a.code
    const bCodeAtom = b.code
    updateCellCode(a.id, 'new code')
    expect(a.code()).toBe('new code')
    expect(b.code()).toBe('')
    // identity stays the same — atomization invariant
    expect(a.code).toBe(aCodeAtom)
    expect(b.code).toBe(bCodeAtom)
  })

  test('changeCellKind switches kind, keeps id and source, resets run state', () => {
    const [cell] = cellsAtom()
    expect(cell.kind).toBe('code')
    changeCellKind(cell.id, 'markdown')
    const after = cellsAtom()[0]
    expect(after.id).toBe(cell.id)
    expect(after.kind).toBe('markdown')
    expect(after.code()).toBe(SEED_CODE)
    expect(after.executionCount()).toBeNull()
    expect(after.status()).toBe('idle')
    expect(after.output()).toEqual([])
  })

  test('changeCellKind is a no-op when the kind is unchanged', () => {
    const [cell] = cellsAtom()
    changeCellKind(cell.id, 'code')
    // identity preserved — no needless re-creation
    expect(cellsAtom()[0]).toBe(cell)
  })

  test('undo/redo reverts and replays adding a cell', () => {
    expect(cellsAtom()).toHaveLength(1)
    addCell()
    expect(cellsAtom()).toHaveLength(2)
    undo()
    expect(cellsAtom()).toHaveLength(1)
    redo()
    expect(cellsAtom()).toHaveLength(2)
  })

  test('undo restores a deleted cell with its source intact', () => {
    const created = addCell()
    updateCellCode(created.id, 'value = 42')
    deleteCell(created.id)
    expect(cellsAtom().some((c) => c.id === created.id)).toBe(false)
    undo() // revert delete
    const restored = cellsAtom().find((c) => c.id === created.id)
    expect(restored?.code()).toBe('value = 42')
  })

  test('editing source is undoable', () => {
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'changed')
    expect(cell.code()).toBe('changed')
    undo()
    expect(cell.code()).toBe(SEED_CODE)
  })

  test('running-state-free actions do not pollute history beyond their op', () => {
    addCell()
    expect(canUndoAtom()).toBe(true)
    undo()
    expect(canRedoAtom()).toBe(true)
  })

  // runCell-related tests live in runtime.test.ts (this file covers only
  // CRUD over cellsAtom now).
})
