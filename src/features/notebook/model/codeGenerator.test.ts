import { afterEach, describe, expect, test } from 'vitest'
import { act } from '@testing-library/react'
import { addCell, cellsAtom, updateCellCode } from './notebook'
import {
  codeGeneratorAtom,
  generateAndInsertCodeAction,
  inBrowserGeneratingCellIdAtom,
  inBrowserGenerateErrorsAtom,
} from './codeGenerator'
import { thinkingSessionAtom } from './inBrowserThinking'

afterEach(() => {
  act(() => {
    codeGeneratorAtom.set(null)
    inBrowserGeneratingCellIdAtom.set(null)
    inBrowserGenerateErrorsAtom.set(new Map())
    thinkingSessionAtom.set(null)
  })
})

function addMarkdownCell(prompt: string) {
  const cell = addCell(undefined, 'markdown')
  updateCellCode(cell.id, prompt)
  return cell
}

describe('generateAndInsertCodeAction — per-cell state (TARDIS-168)', () => {
  test('marks only the generating cell, then clears it on success', async () => {
    const cell = addMarkdownCell('make a constant')
    const countBefore = cellsAtom().length
    let busyDuringRun: string | null = null

    act(() => {
      codeGeneratorAtom.set(() => async () => {
        // Snapshot the busy id WHILE the generator runs.
        busyDuringRun = inBrowserGeneratingCellIdAtom()
        return { code: 'const x = 1', thinking: '', incomplete: false }
      })
    })

    await act(async () => {
      await generateAndInsertCodeAction(cell.id)
    })

    expect(busyDuringRun).toBe(cell.id)
    // Cleared after completion — no leftover spinner on any row.
    expect(inBrowserGeneratingCellIdAtom()).toBeNull()
    expect(cellsAtom().length).toBe(countBefore + 1)
  })

  test('records an engine error against the originating cell only', async () => {
    const cell = addMarkdownCell('boom')
    act(() => {
      codeGeneratorAtom.set(() => async () => {
        throw new Error('engine exploded')
      })
    })

    await act(async () => {
      await generateAndInsertCodeAction(cell.id).catch(() => {})
    })

    expect(inBrowserGenerateErrorsAtom().get(cell.id)?.message).toBe('engine exploded')
    // A different cell is unaffected — the error is not global.
    expect(inBrowserGenerateErrorsAtom().get('other-cell')).toBeUndefined()
    expect(inBrowserGeneratingCellIdAtom()).toBeNull()
  })
})
