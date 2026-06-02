import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as notebookStorage from '../persistence/storage'
import { NewerFormatError } from '../persistence/migrations'
import { FORMAT_VERSION, type NotebookJSON } from '../persistence/schema'
import {
  addCell,
  addCellAt,
  cellsAtom,
  changeCellKind,
  deleteCell,
  loadNotebook,
  LOCAL_NOTEBOOK_ID,
  moveCell,
  moveCellTo,
  notebookTitleAtom,
  SEED_CODE,
  storageCompatibilityAtom,
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

describe('loadNotebook (boot)', () => {
  beforeEach(async () => {
    await notebookStorage.clear()
    notebookTitleAtom.set('Untitled notebook')
    storageCompatibilityAtom.set('ok')
  })

  afterEach(() => {
    // This block spies on storage; restore so the spy never leaks into the
    // sibling tests above (no global restore in this file).
    vi.restoreAllMocks()
  })

  test('seeds and persists a Welcome notebook when storage is empty', async () => {
    // Seeding is not a restore — the return flag is false so the caller keeps
    // the indicator idle for a brand-new notebook.
    expect(await loadNotebook()).toBe(false)
    // Seed cell stays in memory…
    expect(cellsAtom()).toHaveLength(1)
    expect(cellsAtom()[0].code()).toBe(SEED_CODE)
    // …and was written to storage so a reload finds it.
    const stored = await notebookStorage.get(LOCAL_NOTEBOOK_ID)
    expect(stored?.cells[0].content).toBe(SEED_CODE)
  })

  test('restores cells and title from a stored notebook', async () => {
    const stored: NotebookJSON = {
      formatVersion: FORMAT_VERSION,
      id: LOCAL_NOTEBOOK_ID,
      title: 'Restored',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_500_000,
      cells: [
        {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          kind: 'code',
          content: 'restored()',
          updatedAt: 1,
        },
      ],
    }
    await notebookStorage.put(stored)
    // Restoring an existing notebook returns true so the caller can show the
    // saved indicator immediately, seeded from the stored timestamp.
    expect(await loadNotebook()).toBe(true)
    expect(cellsAtom().map((c) => c.code())).toEqual(['restored()'])
    expect(notebookTitleAtom()).toBe('Restored')
  })

  test('does not record the boot transition in history', async () => {
    addCell()
    expect(canUndoAtom()).toBe(true)
    await loadNotebook()
    expect(canUndoAtom()).toBe(false)
  })

  test('stays best-effort when the initial seed write fails', async () => {
    // Empty storage (so the seed-write branch runs) + a rejecting put: the
    // documented failure case (quota / private mode / blocked DB). loadNotebook
    // must NOT reject, so app setup can still start autosave afterwards.
    vi.spyOn(notebookStorage, 'get').mockResolvedValue(undefined)
    vi.spyOn(notebookStorage, 'put').mockRejectedValue(new Error('QuotaExceededError'))
    // A failed seed write is not a restore — returns false, never rejects.
    await expect(loadNotebook()).resolves.toBe(false)
    // Seed stays in memory (not wiped by the failed load), history is cleared
    // on the failure path too (clearHistory moved into `finally`).
    expect(cellsAtom()).toHaveLength(1)
    expect(cellsAtom()[0].code()).toBe(SEED_CODE)
    expect(canUndoAtom()).toBe(false)
  })

  test('marks storage as newer-format and keeps the seed when the stored notebook is too new', async () => {
    vi.spyOn(notebookStorage, 'get').mockRejectedValue(
      new NewerFormatError(FORMAT_VERSION + 1, FORMAT_VERSION),
    )
    // Newer-format is gated, not restored — returns false.
    await expect(loadNotebook()).resolves.toBe(false)
    expect(storageCompatibilityAtom()).toBe('newer-format')
    expect(cellsAtom()).toHaveLength(1)
    expect(cellsAtom()[0].code()).toBe(SEED_CODE)
  })
})
