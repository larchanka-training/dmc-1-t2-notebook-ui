import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from '@testing-library/react'
import { llm } from '@/shared/api'
import { ApiError, RateLimitedError } from '@/shared/api/errors'
import { addCell, cellsAtom, updateCellCode } from './notebook'
import { cloudGenerateAndInsertCodeAction, cloudGeneratingCellIdsAtom } from './cloudCodeGenerator'

const fakeResponse = (
  content: string,
  resultKind: llm.GenerateCodeResponse['resultKind'] = 'code',
): llm.GenerateCodeResponse => ({
  resultKind,
  content,
  model: 'test-model',
  tier: 'backend',
  tokens: { prompt: 10, completion: 5 },
  requestId: 'req-1',
})

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function addMarkdownCell(prompt: string) {
  const cell = addCell(undefined, 'markdown')
  updateCellCode(cell.id, prompt)
  return cell
}

describe('cloudGenerateAndInsertCodeAction', () => {
  test('inserts a code cell below the markdown cell on success', async () => {
    vi.spyOn(llm, 'generateCode').mockResolvedValue(fakeResponse('const x = 1'))
    const cell = addMarkdownCell('create a variable')
    const countBefore = cellsAtom().length

    await act(async () => {
      await cloudGenerateAndInsertCodeAction(cell.id)
    })

    expect(cellsAtom().length).toBe(countBefore + 1)
    const inserted = cellsAtom().at(-1)!
    expect(inserted.kind).toBe('code')
    expect(inserted.code()).toBe('const x = 1')
  })

  test('inserts a markdown cell when backend returns text', async () => {
    vi.spyOn(llm, 'generateCode').mockResolvedValue(
      fakeResponse('Use `reduce` to fold values into one result.', 'text'),
    )
    const cell = addMarkdownCell('explain reduce')
    const countBefore = cellsAtom().length

    await act(async () => {
      await cloudGenerateAndInsertCodeAction(cell.id)
    })

    expect(cellsAtom().length).toBe(countBefore + 1)
    const inserted = cellsAtom().at(-1)!
    expect(inserted.kind).toBe('markdown')
    expect(inserted.code()).toBe('Use `reduce` to fold values into one result.')
  })

  test('passes prompt, context, and language to generateCode', async () => {
    const spy = vi.spyOn(llm, 'generateCode').mockResolvedValue(fakeResponse(''))

    // add some context cells before the markdown cell
    const codeCell = addCell(undefined, 'code')
    updateCellCode(codeCell.id, 'const a = 1')
    const mdCell = addMarkdownCell('use a')

    await act(async () => {
      await cloudGenerateAndInsertCodeAction(mdCell.id)
    })

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'use a',
        language: 'javascript',
        context: expect.arrayContaining([
          expect.objectContaining({ kind: 'code', source: 'const a = 1' }),
        ]),
      }),
    )
  })

  test('does nothing when the markdown cell is empty', async () => {
    const spy = vi.spyOn(llm, 'generateCode')
    const cell = addMarkdownCell('   ')
    const countBefore = cellsAtom().length

    await act(async () => {
      await cloudGenerateAndInsertCodeAction(cell.id)
    })

    expect(spy).not.toHaveBeenCalled()
    expect(cellsAtom().length).toBe(countBefore)
  })

  test('does nothing when the cell id does not exist', async () => {
    const spy = vi.spyOn(llm, 'generateCode')
    const countBefore = cellsAtom().length

    await act(async () => {
      await cloudGenerateAndInsertCodeAction('nonexistent-id')
    })

    expect(spy).not.toHaveBeenCalled()
    expect(cellsAtom().length).toBe(countBefore)
  })

  test('action.ready() is false while generating', async () => {
    let resolveGenerate!: (v: llm.GenerateCodeResponse) => void
    vi.spyOn(llm, 'generateCode').mockReturnValue(
      new Promise<llm.GenerateCodeResponse>((res) => {
        resolveGenerate = res
      }),
    )

    const cell = addMarkdownCell('slow prompt')
    const promise = act(async () => {
      cloudGenerateAndInsertCodeAction(cell.id)
    })

    // action is in-flight — ready() returns false
    expect(cloudGenerateAndInsertCodeAction.ready()).toBe(false)

    resolveGenerate(fakeResponse('done'))
    await promise

    expect(cloudGenerateAndInsertCodeAction.ready()).toBe(true)
  })

  test('keeps later cell marked as generating when an earlier request finishes first', async () => {
    const pending: Array<(v: llm.GenerateCodeResponse) => void> = []
    vi.spyOn(llm, 'generateCode').mockImplementation(
      () =>
        new Promise<llm.GenerateCodeResponse>((resolve) => {
          pending.push(resolve)
        }),
    )

    const firstCell = addMarkdownCell('first prompt')
    const secondCell = addMarkdownCell('second prompt')

    const firstPromise = act(async () => {
      cloudGenerateAndInsertCodeAction(firstCell.id)
    })
    const secondPromise = act(async () => {
      cloudGenerateAndInsertCodeAction(secondCell.id)
    })

    expect(cloudGeneratingCellIdsAtom()).toEqual(new Set([firstCell.id, secondCell.id]))

    pending[0](fakeResponse('first result'))
    await firstPromise

    expect(cloudGeneratingCellIdsAtom()).toEqual(new Set([secondCell.id]))

    pending[1](fakeResponse('second result'))
    await secondPromise

    expect(cloudGeneratingCellIdsAtom()).toEqual(new Set())
  })

  test('stores RateLimitedError with retryAfter in action.error()', async () => {
    vi.spyOn(llm, 'generateCode').mockRejectedValue(
      new RateLimitedError('rate_limited', 'rate limited', 60),
    )
    const cell = addMarkdownCell('anything')

    await act(async () => {
      try {
        await cloudGenerateAndInsertCodeAction(cell.id)
      } catch {
        /* expected */
      }
    })

    const err = cloudGenerateAndInsertCodeAction.error()
    expect(err).toBeInstanceOf(RateLimitedError)
    expect((err as RateLimitedError).retryAfter).toBe(60)
  })

  test('stores error for prompt_rejected response', async () => {
    vi.spyOn(llm, 'generateCode').mockRejectedValue(
      new ApiError(422, 'prompt_rejected', 'prompt_rejected'),
    )
    const cell = addMarkdownCell('bad prompt')

    await act(async () => {
      try {
        await cloudGenerateAndInsertCodeAction(cell.id)
      } catch {
        /* expected */
      }
    })

    expect(cloudGenerateAndInsertCodeAction.error()).toBeInstanceOf(ApiError)
  })
})
