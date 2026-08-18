// Step 8b — negative guarantee for the notebook feature's four generation entry
// points: with LLM features OFF, none of them requests, runs, or inserts.
//
// The full inventory of guarded entry points across the app is listed in
// `entities/llm-availability/model/llmAvailability.ts`; the sibling suites are
// `features/web-llm/model/webLlm.llmEnabled.test.ts`,
// `pages/llm-playground/model/cloudPlayground.test.ts` and the auto-load case in
// `app/model/settingsSync.test.ts`. Positive paths stay in the per-action suites.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { wrap } from '@reatom/core'
import { llm } from '@/shared/api'
import { llmEnabledAtom } from '@/entities/llm-availability'
import { addCell, cellsAtom, updateCellCode } from './notebook'
import { cloudGenerateAndInsertCodeAction } from './cloudCodeGenerator'
import { generateAndInsertCodeAction, codeGeneratorAtom } from './codeGenerator'
import { agentSendAction, agentSendInBrowserAction, agentChatOpenAtom } from './agentChat'

let generateSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  generateSpy = vi.spyOn(llm, 'generateCode')
  llmEnabledAtom.set(false)
})

afterEach(() => {
  llmEnabledAtom.set(true)
  codeGeneratorAtom.set(() => null)
  agentChatOpenAtom.set(false)
  vi.restoreAllMocks()
})

/** A cell holding a non-empty prompt, so nothing short-circuits before the guard. */
function promptCell(): string {
  const cell = addCell()
  updateCellCode(cell.id, 'sum two numbers')
  return cell.id
}

describe('llmEnabled = false — cloud tier', () => {
  test('cell cloud generate sends no request', async () => {
    await wrap(cloudGenerateAndInsertCodeAction(promptCell()))
    expect(generateSpy).not.toHaveBeenCalled()
  })

  test('Ask-agent cloud tier sends no request and leaves the dialog open', async () => {
    agentChatOpenAtom.set(true)
    await wrap(agentSendAction('write a fibonacci function'))
    expect(generateSpy).not.toHaveBeenCalled()
    // The success path closes the dialog; a refused send must not, or the user's
    // prompt vanishes with no explanation.
    expect(agentChatOpenAtom()).toBe(true)
  })
})

describe('llmEnabled = false — in-browser tier', () => {
  test('cell in-browser generate does not run the injected generator', async () => {
    // A generator IS available: the guard must win over a ready model, otherwise
    // "LLM off" would still generate for anyone who had loaded one earlier.
    const generator = vi.fn()
    // `.set(fn)` treats a function as an UPDATER (Reatom calls it with the previous
    // value), so injecting a function-valued atom needs `.set(() => fn)`.
    codeGeneratorAtom.set(() => generator as never)
    const before = cellsAtom().length

    await wrap(generateAndInsertCodeAction(promptCell()))

    expect(generator).not.toHaveBeenCalled()
    // `promptCell()` added one cell; a generation would have added a second.
    expect(cellsAtom().length).toBe(before + 1)
  })

  test('Ask-agent in-browser tier does not run the generator', async () => {
    const generator = vi.fn()
    codeGeneratorAtom.set(() => generator as never)
    const before = cellsAtom().length

    await wrap(agentSendInBrowserAction('write a fibonacci function'))

    expect(generator).not.toHaveBeenCalled()
    expect(cellsAtom().length).toBe(before)
  })
})

describe('llmEnabled = true — the guard does not over-block', () => {
  test('cell cloud generate still sends when enabled', async () => {
    llmEnabledAtom.set(true)
    generateSpy.mockResolvedValue({
      resultKind: 'code',
      content: 'const x = 1',
      model: 'test-model',
      tier: 'backend',
      tokens: { prompt: 1, completion: 2 },
      requestId: 'req-gate',
    } as llm.GenerateCodeResponse)

    await wrap(cloudGenerateAndInsertCodeAction(promptCell()))

    expect(generateSpy).toHaveBeenCalledTimes(1)
  })
})
