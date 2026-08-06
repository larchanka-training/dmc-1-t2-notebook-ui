import { describe, expect, test } from 'vitest'
import type { OutputItem } from '../runtime/types'
import {
  CELL_MAX_BYTES,
  HTML_MAX_BYTES,
  IMAGE_MAX_BYTES,
  NOTEBOOK_MAX_BYTES,
  OUTPUT_TOO_LARGE_NAME,
  isNotebookOutputOverlay,
  isOutputTooLarge,
  projectCellOutputs,
  projectNotebookOverlay,
} from './outputOverlay'

const encoder = new TextEncoder()
/** Byte length of a value's JSON serialization — the actually-stored form. */
const serializedBytes = (value: unknown): number => encoder.encode(JSON.stringify(value)).length

// ── builders ────────────────────────────────────────────────────────────────
const stdout = (text: string): OutputItem => ({ type: 'stdout', text })
const result = (value: number): OutputItem => ({
  type: 'result',
  value: { kind: 'primitive', value },
})
const html = (markup: string): OutputItem => ({ type: 'html', html: markup })
const image = (data: string, mime = 'image/png'): OutputItem => ({ type: 'image', mime, data })
const runtimeError = (): OutputItem => ({ type: 'error', name: 'TypeError', message: 'boom' })

const cell = (
  cellId: string,
  items: OutputItem[],
  sourceUpdatedAt = 1,
): { cellId: string; sourceUpdatedAt: number; items: OutputItem[] } => ({
  cellId,
  sourceUpdatedAt,
  items,
})

describe('caps are exact bytes', () => {
  test('the documented byte caps', () => {
    expect(HTML_MAX_BYTES).toBe(256 * 1024)
    expect(IMAGE_MAX_BYTES).toBe(2 * 1024 * 1024)
    expect(CELL_MAX_BYTES).toBe(4 * 1024 * 1024)
    expect(NOTEBOOK_MAX_BYTES).toBe(32 * 1024 * 1024)
  })
})

describe('projectCellOutputs — persistable filter', () => {
  test('keeps only result/html/image; drops streams and real runtime errors', () => {
    const out = projectCellOutputs({
      cellId: 'c1',
      sourceUpdatedAt: 7,
      savedAt: 100,
      items: [stdout('log'), result(1), html('<b>x</b>'), image('AAAA'), runtimeError()],
    })
    expect(out.items.map((i) => i.type)).toEqual(['result', 'html', 'image'])
    expect(out).toMatchObject({ cellId: 'c1', sourceUpdatedAt: 7, savedAt: 100 })
  })
})

describe('projectCellOutputs — per-item caps', () => {
  test('oversized html becomes an OutputTooLarge placeholder', () => {
    const big = html('x'.repeat(HTML_MAX_BYTES + 1))
    const out = projectCellOutputs({ cellId: 'c', sourceUpdatedAt: 1, savedAt: 0, items: [big] })
    expect(out.items).toHaveLength(1)
    expect(isOutputTooLarge(out.items[0] as OutputItem)).toBe(true)
  })

  test('html exactly at the cap is kept verbatim', () => {
    const atCap = html('x'.repeat(HTML_MAX_BYTES))
    const out = projectCellOutputs({ cellId: 'c', sourceUpdatedAt: 1, savedAt: 0, items: [atCap] })
    expect(out.items[0]).toEqual(atCap)
  })

  test('oversized image becomes a placeholder; small image is kept', () => {
    const bigImg = image('A'.repeat(IMAGE_MAX_BYTES + 1))
    const smallImg = image('A'.repeat(10))
    const out = projectCellOutputs({
      cellId: 'c',
      sourceUpdatedAt: 1,
      savedAt: 0,
      items: [smallImg, bigImg],
    })
    expect(out.items[0]).toEqual(smallImg)
    expect(isOutputTooLarge(out.items[1] as OutputItem)).toBe(true)
  })
})

describe('projectCellOutputs — per-cell cap enforced on the serialized items', () => {
  test('truncates oldest-first, appends one placeholder, and stays within the cap', () => {
    // Each image is ~1.5 MiB of base64 → three exceed the 4 MiB cell cap.
    const oneAndHalfMiB = 'A'.repeat(1.5 * 1024 * 1024)
    const out = projectCellOutputs({
      cellId: 'c',
      sourceUpdatedAt: 1,
      savedAt: 0,
      items: [image(oneAndHalfMiB), image(oneAndHalfMiB), image(oneAndHalfMiB)],
    })
    const kept = out.items.filter((i) => i.type === 'image')
    const placeholders = out.items.filter((i) => isOutputTooLarge(i as OutputItem))
    expect(kept).toHaveLength(2)
    expect(placeholders).toHaveLength(1)
    expect(out.items.at(-1)).toMatchObject({ name: OUTPUT_TOO_LARGE_NAME })
    // Invariant: the ACTUAL stored representation is within the cap.
    expect(serializedBytes(out.items)).toBeLessThanOrEqual(CELL_MAX_BYTES)
  })

  test('a single over-cap result yields only the placeholder, within the cap', () => {
    const huge = { type: 'result', value: { kind: 'primitive', value: 'z'.repeat(CELL_MAX_BYTES) } }
    const out = projectCellOutputs({
      cellId: 'c',
      sourceUpdatedAt: 1,
      savedAt: 0,
      items: [huge as OutputItem],
    })
    expect(out.items).toHaveLength(1)
    expect(isOutputTooLarge(out.items[0] as OutputItem)).toBe(true)
    expect(serializedBytes(out.items)).toBeLessThanOrEqual(CELL_MAX_BYTES)
  })
})

describe('projectNotebookOverlay', () => {
  test('skips cells with no persistable items; no overflow when everything fits', () => {
    const overlay = projectNotebookOverlay({
      notebookId: 'nb',
      savedAt: 5,
      cells: [cell('a', [stdout('only logs')]), cell('b', [result(2)])],
    })
    expect(overlay.cells.map((c) => c.cellId)).toEqual(['b'])
    expect(overlay.overflow).toBeNull()
    expect(overlay.savedAt).toBe(5)
  })

  test('notebook cap: keeps an oldest-first prefix, records a bounded overflow marker, stays within cap', () => {
    // Each cell carries a ~2 MiB image; 20 cells ≈ 40 MiB > 32 MiB cap.
    const twoMiB = 'A'.repeat(2 * 1024 * 1024)
    const cells = Array.from({ length: 20 }, (_, i) => cell(`c${i}`, [image(twoMiB)]))
    const overlay = projectNotebookOverlay({ notebookId: 'nb', savedAt: 0, cells })

    expect(overlay.cells.length).toBeGreaterThan(0)
    expect(overlay.overflow).not.toBeNull()
    // Kept cells are an oldest-first prefix of the input.
    const keptIds = overlay.cells.map((c) => c.cellId)
    expect(keptIds).toEqual(cells.slice(0, keptIds.length).map((c) => c.cellId))
    // The bounded marker counts exactly the omitted cells (no id list).
    expect(overlay.overflow?.droppedCellCount).toBe(cells.length - keptIds.length)
    // Invariant: the ACTUAL stored overlay is within the cap.
    expect(serializedBytes(overlay)).toBeLessThanOrEqual(NOTEBOOK_MAX_BYTES)
  })

  test('preserves each cell version stamp', () => {
    const overlay = projectNotebookOverlay({
      notebookId: 'nb',
      savedAt: 9,
      cells: [cell('a', [result(1)], 42)],
    })
    expect(overlay.cells[0]).toMatchObject({ cellId: 'a', sourceUpdatedAt: 42, savedAt: 9 })
  })
})

describe('isOutputTooLarge', () => {
  test('distinguishes the placeholder from a real runtime error', () => {
    expect(isOutputTooLarge({ type: 'error', name: OUTPUT_TOO_LARGE_NAME, message: '' })).toBe(true)
    expect(isOutputTooLarge(runtimeError())).toBe(false)
    expect(isOutputTooLarge(stdout('x'))).toBe(false)
  })
})

describe('isNotebookOutputOverlay (boundary validator)', () => {
  test('accepts a well-formed overlay (round-trip of projectNotebookOverlay)', () => {
    const overlay = projectNotebookOverlay({
      notebookId: 'nb',
      savedAt: 1,
      cells: [cell('a', [result(1), image('AAAA')])],
    })
    expect(isNotebookOutputOverlay(overlay)).toBe(true)
    // Survives a JSON round-trip (what IndexedDB stores/returns).
    expect(isNotebookOutputOverlay(JSON.parse(JSON.stringify(overlay)))).toBe(true)
  })

  test('accepts an overflow marker', () => {
    expect(
      isNotebookOutputOverlay({
        notebookId: 'nb',
        savedAt: 1,
        overflow: { droppedCellCount: 3 },
        cells: [],
      }),
    ).toBe(true)
  })

  test('rejects corrupt / foreign shapes', () => {
    expect(isNotebookOutputOverlay(null)).toBe(false)
    expect(isNotebookOutputOverlay({ notebookId: 1, savedAt: 1, overflow: null, cells: [] })).toBe(
      false,
    )
    expect(
      isNotebookOutputOverlay({ notebookId: 'nb', savedAt: 'x', overflow: null, cells: [] }),
    ).toBe(false)
    expect(isNotebookOutputOverlay({ notebookId: 'nb', savedAt: 1, overflow: {}, cells: [] })).toBe(
      false,
    )
    expect(
      isNotebookOutputOverlay({
        notebookId: 'nb',
        savedAt: 1,
        overflow: null,
        cells: [{ cellId: 'a' }],
      }),
    ).toBe(false)
    expect(isNotebookOutputOverlay({ notebookId: 'nb', savedAt: 1, overflow: null })).toBe(false)
  })
})
