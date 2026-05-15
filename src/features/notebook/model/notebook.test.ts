import { describe, expect, test } from 'vitest'
import {
  addCell,
  cellsAtom,
  deleteCell,
  moveCell,
  runCell,
  SEED_CODE,
  updateCellCode,
} from './notebook'

describe('notebook store', () => {
  test('starts with exactly one seed cell', () => {
    const cells = cellsAtom()
    expect(cells).toHaveLength(1)
    expect(cells[0].code()).toBe(SEED_CODE)
    expect(cells[0].status()).toBe('idle')
    expect(cells[0].output()).toBe('')
  })

  test('addCell() appends an empty cell to the end', () => {
    const before = cellsAtom()
    addCell()
    const after = cellsAtom()
    expect(after).toHaveLength(before.length + 1)
    expect(after.at(-1)!.code()).toBe('')
    expect(after.at(-1)!.status()).toBe('idle')
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

  test('runCell drives the status through running -> done with captured output', async () => {
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'console.log("answer", 42)')
    const promise = runCell(cell.id)
    expect(cell.status()).toBe('running')
    expect(cell.output()).toBe('')
    await promise
    expect(cell.status()).toBe('done')
    expect(cell.output()).toBe('answer 42')
  })

  test('runCell sets status=error when the code throws', async () => {
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'throw new Error("nope")')
    await runCell(cell.id)
    expect(cell.status()).toBe('error')
    expect(cell.output()).toContain('nope')
  })

  test('runCell on an unknown id is a no-op', async () => {
    await expect(runCell('does-not-exist')).resolves.toBeUndefined()
  })
})
