import { afterEach, describe, expect, test, vi } from 'vitest'
import { FORMAT_VERSION } from '../persistence/schema'
import {
  activeNotebookIdAtom,
  addCell,
  addCellAt,
  cellsAtom,
  changeCellKind,
  deleteCell,
  LOCAL_NOTEBOOK_ID,
  moveCell,
  moveCellTo,
  notebookSnapshot,
  restoreNotebook,
  updateCellCode,
} from './notebook'
import { canRedoAtom, canUndoAtom, redo, undo } from './history'

describe('notebook store', () => {
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
    expect(after.code()).toBe('')
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

  test('changeCellKind is a no-op while the cell is running', () => {
    const [cell] = cellsAtom()
    cell.status.set('running')
    changeCellKind(cell.id, 'markdown')
    // Re-creating a running cell would orphan the atoms executeCell writes to.
    expect(cellsAtom()[0]).toBe(cell)
    expect(cellsAtom()[0].kind).toBe('code')
  })

  test('deleteCell is a no-op while the cell is running', () => {
    const [seed] = cellsAtom()
    const second = addCell()
    second.status.set('running')
    deleteCell(second.id)
    // The running cell survives so the kernel can finish / be interrupted.
    expect(cellsAtom().map((c) => c.id)).toEqual([seed.id, second.id])
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
    expect(cell.code()).toBe('')
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

// Persistence/sync prep: every cell carries a content-modification timestamp
// (basis for last-write-wins) and a real UUID id (the backend contract expects
// `format: uuid`). These cover the domain guarantees the serializer relies on.
describe('cell updatedAt + id (sync prep)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('reatomCell assigns a UUID id', () => {
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    expect(cellsAtom()[0].id).toMatch(uuidRe)
    expect(addCell().id).toMatch(uuidRe)
  })

  test('updateCellCode bumps updatedAt', () => {
    vi.useFakeTimers()
    const [cell] = cellsAtom()
    const before = cell.updatedAt()
    vi.advanceTimersByTime(1000)
    updateCellCode(cell.id, 'changed')
    expect(cell.updatedAt()).toBeGreaterThan(before)
  })

  test('updateCellCode does not bump updatedAt for a no-op edit', () => {
    vi.useFakeTimers()
    const [cell] = cellsAtom()
    const before = cell.updatedAt()
    vi.advanceTimersByTime(1000)
    updateCellCode(cell.id, cell.code()) // same content
    expect(cell.updatedAt()).toBe(before)
  })

  test('reorder does not bump updatedAt (order is notebook-level)', () => {
    vi.useFakeTimers()
    const a = cellsAtom()[0]
    const b = addCell()
    const aBefore = a.updatedAt()
    const bBefore = b.updatedAt()
    vi.advanceTimersByTime(1000)
    moveCellTo(b.id, 0)
    expect(a.updatedAt()).toBe(aBefore)
    expect(b.updatedAt()).toBe(bBefore)
  })

  test('changeCellKind bumps updatedAt on the re-created cell', () => {
    vi.useFakeTimers()
    const [cell] = cellsAtom()
    const before = cell.updatedAt()
    vi.advanceTimersByTime(1000)
    changeCellKind(cell.id, 'markdown')
    expect(cellsAtom()[0].updatedAt()).toBeGreaterThan(before)
  })

  test('undo restores the previous updatedAt', () => {
    vi.useFakeTimers()
    const [cell] = cellsAtom()
    const before = cell.updatedAt()
    vi.advanceTimersByTime(1000)
    updateCellCode(cell.id, 'changed')
    expect(cell.updatedAt()).toBeGreaterThan(before)
    undo()
    expect(cell.updatedAt()).toBe(before)
  })
})

describe('activeNotebookIdAtom (slot id source)', () => {
  afterEach(() => {
    // Restore the default slot id so a switched id never leaks into siblings.
    activeNotebookIdAtom.set(LOCAL_NOTEBOOK_ID)
  })

  test('defaults to the local notebook id', () => {
    expect(activeNotebookIdAtom()).toBe(LOCAL_NOTEBOOK_ID)
  })

  test('restoreNotebook adopts the stored id, and the snapshot follows it', () => {
    const otherId = '11111111-1111-4111-8111-111111111111'
    restoreNotebook({
      formatVersion: FORMAT_VERSION,
      id: otherId,
      title: 'Other',
      createdAt: 1,
      updatedAt: 2,
      cells: [
        { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', kind: 'code', content: 'x', updatedAt: 1 },
      ],
    })
    // The id is now first-class slot state, not the hard-wired constant: the
    // serializer keys the snapshot by the active id so autosave writes under it.
    expect(activeNotebookIdAtom()).toBe(otherId)
    expect(notebookSnapshot().id).toBe(otherId)
  })
})
