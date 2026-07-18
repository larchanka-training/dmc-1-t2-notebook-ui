import { describe, expect, test } from 'vitest'
import { formatCloudGenerateError } from './NotebookView'
import { ApiError, RateLimitedError } from '@/shared/api/errors'

describe('formatCloudGenerateError', () => {
  test('rate limit with retry-after', () => {
    const err = new RateLimitedError('llm_throttled', 'throttled', 30)
    expect(formatCloudGenerateError(err)).toBe('Rate limit reached. Try again in 30s.')
  })

  test('rate limit without retry-after', () => {
    const err = new RateLimitedError('llm_throttled', 'throttled')
    expect(formatCloudGenerateError(err)).toBe('Rate limit reached.')
  })

  test('llm_internal returns user-friendly unavailable message', () => {
    const err = new ApiError(500, 'llm_internal', 'LLM provider validation failed')
    expect(formatCloudGenerateError(err)).toBe(
      'Cloud AI is temporarily unavailable. Use the local model instead.',
    )
  })

  test('llm_access_denied returns user-friendly unavailable message', () => {
    const err = new ApiError(500, 'llm_access_denied', 'LLM provider access denied')
    expect(formatCloudGenerateError(err)).toBe(
      'Cloud AI is temporarily unavailable. Use the local model instead.',
    )
  })

  test('prompt rejection', () => {
    const err = new Error('prompt_rejected by safety filter')
    expect(formatCloudGenerateError(err)).toBe('Prompt was flagged by the safety filter.')
  })

  test('timeout', () => {
    const err = new Error('llm_timeout exceeded')
    expect(formatCloudGenerateError(err)).toBe(
      'Cloud generation timed out. Try the local model instead.',
    )
  })

  test('503 unavailable', () => {
    const err = new Error('503 service unavailable')
    expect(formatCloudGenerateError(err)).toBe(
      'Cloud AI is temporarily unavailable. Try the local model instead.',
    )
  })

  test('unknown error falls back to message', () => {
    const err = new Error('something unexpected')
    expect(formatCloudGenerateError(err)).toBe('Cloud generation failed: something unexpected')
  })
})
