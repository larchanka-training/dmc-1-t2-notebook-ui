import { describe, expect, test } from 'vitest'
import type { llm } from '@/shared/api'
import { cellKindForLlmResult } from './llmResult'

const response = (
  resultKind: llm.GenerateCodeResponse['resultKind'],
): llm.GenerateCodeResponse => ({
  resultKind,
  content: '',
  model: 'test-model',
  tier: 'backend',
  tokens: { prompt: 0, completion: 0 },
  requestId: 'req-1',
})

describe('cellKindForLlmResult', () => {
  test('maps code responses to code cells', () => {
    expect(cellKindForLlmResult(response('code'))).toBe('code')
  })

  test('maps text responses to markdown cells', () => {
    expect(cellKindForLlmResult(response('text'))).toBe('markdown')
  })
})
