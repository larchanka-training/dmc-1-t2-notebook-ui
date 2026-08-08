import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { activeNotebookIdAtom, cellsAtom, deleteCell, updateCellCode } from './notebook'
import { restartKernel, runCell } from './runtime'
import { restartWorker } from '../runtime/workerHost'
import { notebookStorage } from '../persistence/activeStorage'

// Drain microtasks so an in-flight executeCell / fire-and-forget overlay write
// settles before the next assertion (mirrors runtime.test.ts).
const drain = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

const overlayFor = () => notebookStorage.getOverlay(activeNotebookIdAtom())

beforeEach(async () => {
  restartKernel()
  await drain()
  const ids = cellsAtom().map((c) => c.id)
  for (let i = 1; i < ids.length; i++) deleteCell(ids[i])
  cellsAtom()[0]!.code.set('')
  await drain() // let restartKernel's overlay delete settle
})

afterEach(async () => {
  restartWorker()
  await drain()
})

describe('runtime — output overlay persistence (Step 6 save wiring)', () => {
  test('a rich output is persisted to the overlay after a run', async () => {
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'display({ type: "image", mime: "image/png", data: "AAAA" })')
    await runCell(cell.id)

    const overlay = await overlayFor()
    const saved = overlay?.cells.find((c) => c.cellId === cell.id)
    expect(saved?.items).toContainEqual({ type: 'image', mime: 'image/png', data: 'AAAA' })
    // Stamped with the version at run start.
    expect(saved?.sourceUpdatedAt).toBe(cell.updatedAt())
  })

  test('a stream-only run persists nothing (overlay stays absent)', async () => {
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'console.log("just logs")')
    await runCell(cell.id)
    expect(await overlayFor()).toBeUndefined()
  })

  test('editing the cell source during its run drops the output (C6.2)', async () => {
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'display({ type: "image", mime: "image/png", data: "AAAA" })')
    const p = runCell(cell.id)
    // Bump the content version mid-run (as a source edit would): the run-start
    // stamp no longer matches, so the produced output is not persisted.
    cell.updatedAt.set(cell.updatedAt() + 1)
    await p
    expect(await overlayFor()).toBeUndefined()
  })

  test('a notebook switch during a run leaves the other notebook overlay intact (fence)', async () => {
    const original = activeNotebookIdAtom()
    const other = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    await notebookStorage.putOverlay({
      notebookId: other,
      savedAt: 1,
      overflow: null,
      cells: [
        {
          cellId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          sourceUpdatedAt: 1,
          savedAt: 1,
          items: [{ type: 'image', mime: 'image/png', data: 'ZZZZ' }],
        },
      ],
    })
    try {
      const [cell] = cellsAtom()
      updateCellCode(cell.id, 'display({ type: "image", mime: "image/png", data: "AAAA" })')
      const p = runCell(cell.id)
      activeNotebookIdAtom.set(other) // the slot switches while the run is in flight
      await p
      // Completing the run in the original notebook must NOT touch `other`.
      const otherOverlay = await notebookStorage.getOverlay(other)
      expect(otherOverlay?.cells[0]?.items[0]).toMatchObject({ data: 'ZZZZ' })
    } finally {
      activeNotebookIdAtom.set(original)
      await notebookStorage.deleteOverlay(other)
    }
  })

  test('restartKernel clears the persisted overlay', async () => {
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'display({ type: "image", mime: "image/png", data: "AAAA" })')
    await runCell(cell.id)
    expect(await overlayFor()).toBeDefined()

    restartKernel()
    await drain()
    expect(await overlayFor()).toBeUndefined()
  })
})
