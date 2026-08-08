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
