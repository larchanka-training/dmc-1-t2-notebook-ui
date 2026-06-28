import { afterEach, describe, expect, test } from 'vitest'
import { act } from '@testing-library/react'
import { addCell, cellsAtom, updateCellCode } from './notebook'
import {
  codeGeneratorAtom,
  generateAndInsertCodeAction,
  inBrowserGeneratingCellIdAtom,
  inBrowserGenerateErrorsAtom,
} from './codeGenerator'
import { thinkingSessionAtom, requestStopAction } from './inBrowserThinking'

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

  test('refuses a second concurrent generation while one is active (single-flight, H1)', async () => {
    const first = addMarkdownCell('first')
    const second = addMarkdownCell('second')
    const countBefore = cellsAtom().length
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })

    act(() => {
      codeGeneratorAtom.set(() => async () => {
        calls += 1
        await gate // hold the first run open so the second one races it
        return { code: 'const x = 1', thinking: '', incomplete: false }
      })
    })

    let firstRun!: Promise<void>
    await act(async () => {
      firstRun = generateAndInsertCodeAction(first.id)
      // Second trigger WHILE the first is still streaming — must be refused.
      await generateAndInsertCodeAction(second.id)
    })

    // Only the first run started; the second was rejected by the guard.
    expect(calls).toBe(1)
    expect(inBrowserGeneratingCellIdAtom()).toBe(first.id)

    await act(async () => {
      release()
      await firstRun
    })

    // Exactly one cell inserted (from the first run), busy id cleared.
    expect(calls).toBe(1)
    expect(cellsAtom().length).toBe(countBefore + 1)
    expect(inBrowserGeneratingCellIdAtom()).toBeNull()
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

  test('a user Stop closes the block quietly instead of showing a model failure', async () => {
    const cell = addMarkdownCell('loop')
    act(() => {
      codeGeneratorAtom.set(() => async () => {
        // Model is interrupted by the user: it returns incomplete (no code) but
        // the session is flagged stopRequested. This must NOT read as a failure.
        requestStopAction()
        return { code: '', thinking: 'partial', incomplete: true }
      })
    })

    await act(async () => {
      await generateAndInsertCodeAction(cell.id)
    })

    // Block closed (finish), not left in the accusatory 'failed' phase.
    expect(thinkingSessionAtom()).toBeNull()
    expect(inBrowserGeneratingCellIdAtom()).toBeNull()
  })
})
