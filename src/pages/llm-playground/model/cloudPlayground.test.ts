import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { wrap } from '@reatom/core'
import { llm } from '@/shared/api'
import { llmEnabledAtom } from '@/entities/llm-availability'
import { cloudMessagesAtom, cloudSendAction } from './cloudPlayground'

const fakeResponse = (content: string): llm.GenerateCodeResponse => ({
  resultKind: 'code',
  content,
  model: 'test-model',
  tier: 'backend',
  tokens: { prompt: 3, completion: 5 },
  requestId: 'req-playground',
})

beforeEach(() => {
  cloudMessagesAtom.set([])
  vi.restoreAllMocks()
})

afterEach(() => {
  cloudMessagesAtom.set([])
  vi.restoreAllMocks()
})

describe('cloudSendAction', () => {
  test('appends user and assistant messages on success', async () => {
    const spy = vi.spyOn(llm, 'generateCode').mockResolvedValue(fakeResponse('cloud answer'))

    await wrap(cloudSendAction('hello cloud'))

    expect(spy).toHaveBeenCalledWith({
      prompt: 'hello cloud',
      language: 'javascript',
      mode: 'generate',
    })
    expect(cloudMessagesAtom()).toEqual([
      { role: 'user', content: 'hello cloud' },
      { role: 'assistant', content: 'cloud answer' },
    ])
  })

  test('keeps the user message and rejects on cloud errors', async () => {
    vi.spyOn(llm, 'generateCode').mockRejectedValue(new Error('cloud unavailable'))

    await expect(wrap(cloudSendAction('will fail'))).rejects.toThrow('cloud unavailable')

    expect(cloudMessagesAtom()).toEqual([{ role: 'user', content: 'will fail' }])
  })
})

// Step 8b — the playground's cloud panel is one of the guarded entry points
// (inventory: `entities/llm-availability`).
describe('cloudSendAction with LLM features off', () => {
  afterEach(() => {
    llmEnabledAtom.set(true)
  })

  test('sends no request and leaves the transcript untouched', async () => {
    const spy = vi.spyOn(llm, 'generateCode')
    llmEnabledAtom.set(false)

    await wrap(cloudSendAction('hello cloud'))

    expect(spy).not.toHaveBeenCalled()
    // The user message is appended optimistically BEFORE the request, so the
    // guard has to run first — otherwise the transcript keeps a question that
    // can never get an answer.
    expect(cloudMessagesAtom()).toEqual([])
  })
})
