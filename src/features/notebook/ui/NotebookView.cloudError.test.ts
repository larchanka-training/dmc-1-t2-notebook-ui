import { describe, expect, test } from 'vitest'
import { formatCloudGenerateError } from './NotebookView'
import { ApiError, ForbiddenError, RateLimitedError } from '@/shared/api/errors'
import { CLOUD_LLM_RESTRICTED_MESSAGE } from '../lib/cloudLlmAvailability'

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
      'Cloud AI is temporarily unavailable. Use the in-browser model instead.',
    )
  })

  test('llm_access_denied at 500 stays "temporarily unavailable"', () => {
    // 500 + llm_access_denied means the SERVER's provider credentials were
    // rejected. That IS an outage, and retrying later can succeed.
    const err = new ApiError(500, 'llm_access_denied', 'LLM provider access denied')
    expect(formatCloudGenerateError(err)).toBe(
      'Cloud AI is temporarily unavailable. Use the in-browser model instead.',
    )
  })

  test('llm_access_denied at 403 says the account is not in the private test group', () => {
    // Same error CODE, different meaning: the account is outside the Step 8d-2
    // allowlist. Permanent for this user — calling it "temporarily unavailable"
    // would invite a retry loop against something that will never succeed.
    const err = new ForbiddenError('llm_access_denied', 'not allowlisted')
    expect(formatCloudGenerateError(err)).toBe(CLOUD_LLM_RESTRICTED_MESSAGE)
  })

  test('the two llm_access_denied cases produce DIFFERENT copy', () => {
    // The regression guard: distinguishing them is the whole point, so assert
    // they diverge rather than trusting two independent string assertions.
    const outage = new ApiError(500, 'llm_access_denied', 'LLM provider access denied')
    const notAllowlisted = new ForbiddenError('llm_access_denied', 'not allowlisted')
    expect(formatCloudGenerateError(outage)).not.toBe(formatCloudGenerateError(notAllowlisted))
  })

  test('a 403 with a DIFFERENT code is not treated as an allowlist denial', () => {
    // The status alone must not decide: only 403 + llm_access_denied is the
    // allowlist case. Anything else falls through to generic handling.
    const err = new ForbiddenError('some_other_reason', 'forbidden for another reason')
    expect(formatCloudGenerateError(err)).not.toBe(CLOUD_LLM_RESTRICTED_MESSAGE)
  })

  test('the 403 copy does not suggest retrying', () => {
    const err = new ForbiddenError('llm_access_denied', 'not allowlisted')
    const message = formatCloudGenerateError(err).toLowerCase()
    expect(message).not.toContain('try again')
    expect(message).not.toContain('temporarily')
  })

  test('prompt rejection', () => {
    const err = new Error('prompt_rejected by safety filter')
    expect(formatCloudGenerateError(err)).toBe('Prompt was flagged by the safety filter.')
  })

  test('timeout', () => {
    const err = new Error('llm_timeout exceeded')
    expect(formatCloudGenerateError(err)).toBe(
      'Cloud generation timed out. Use the in-browser model instead.',
    )
  })

  test('503 unavailable', () => {
    const err = new Error('503 service unavailable')
    expect(formatCloudGenerateError(err)).toBe(
      'Cloud AI is temporarily unavailable. Use the in-browser model instead.',
    )
  })

  test('unknown error falls back to message', () => {
    const err = new Error('something unexpected')
    expect(formatCloudGenerateError(err)).toBe('Cloud generation failed: something unexpected')
  })
})
