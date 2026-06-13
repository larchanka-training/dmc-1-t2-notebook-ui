import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  ApiError,
  BadRequestError,
  ConflictError,
  NetworkError,
  NotFoundError,
  parseRetryAfter,
  UnauthorizedError,
  toApiError,
} from './errors'

describe('toApiError', () => {
  test('400 → BadRequestError with code and message from envelope', () => {
    const err = toApiError(400, { error: { code: 'invalid', message: 'bad body' } })
    expect(err).toBeInstanceOf(BadRequestError)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(400)
    expect(err.code).toBe('invalid')
    expect(err.message).toBe('bad body')
  })

  test('401 → UnauthorizedError', () => {
    const err = toApiError(401, { error: { code: 'unauthenticated', message: 'no token' } })
    expect(err).toBeInstanceOf(UnauthorizedError)
    expect(err.status).toBe(401)
  })

  test('404 → NotFoundError', () => {
    const err = toApiError(404, { error: { code: 'not_found', message: 'gone' } })
    expect(err).toBeInstanceOf(NotFoundError)
    expect(err.status).toBe(404)
  })

  test('409 → ConflictError', () => {
    const err = toApiError(409, { error: { code: 'notebook_conflict', message: 'id taken' } })
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.status).toBe(409)
    expect(err.code).toBe('notebook_conflict')
  })

  test('legacy flat error bodies are still accepted defensively', () => {
    const err = toApiError(400, { code: 'invalid', message: 'bad body' })
    expect(err).toBeInstanceOf(BadRequestError)
    expect(err.code).toBe('invalid')
  })

  test('validation-error bodies (no code/message) fall back to generic ApiError', () => {
    const err = toApiError(422, {
      detail: [{ loc: ['body', 'title'], msg: 'field required', type: 'missing' }],
    })
    expect(err.constructor).toBe(ApiError)
    expect(err.status).toBe(422)
    expect(err.code).toBeUndefined()
  })

  test('5xx falls back to generic ApiError', () => {
    const err = toApiError(503, undefined)
    expect(err.constructor).toBe(ApiError)
    expect(err.status).toBe(503)
    expect(err.code).toBeUndefined()
  })

  test('missing body still produces a useful message', () => {
    const err = toApiError(500, undefined)
    expect(err.message).toContain('500')
  })
})

describe('NetworkError', () => {
  test('is an ApiError with status 0 and a default message', () => {
    const err = new NetworkError()
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toBeInstanceOf(NetworkError)
    expect(err.status).toBe(0)
    expect(err.message).toBe('Network request failed')
  })

  test('preserves a custom message and the originating cause', () => {
    const cause = new TypeError('Failed to fetch')
    const err = new NetworkError('offline', cause)
    expect(err.message).toBe('offline')
    expect(err.cause).toBe(cause)
  })
})

describe('parseRetryAfter', () => {
  const NOW = Date.parse('2026-06-13T12:00:00Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('delta-seconds: a non-negative integer is returned (trimmed)', () => {
    expect(parseRetryAfter('120')).toBe(120)
    expect(parseRetryAfter('0')).toBe(0)
    expect(parseRetryAfter('  30  ')).toBe(30)
  })

  test('a future HTTP-date is converted to a delay in seconds from now', () => {
    expect(parseRetryAfter('Sat, 13 Jun 2026 12:02:00 GMT')).toBe(120)
  })

  test('a past HTTP-date clamps to 0 (retry now)', () => {
    expect(parseRetryAfter('Sat, 13 Jun 2026 11:59:00 GMT')).toBe(0)
  })

  test('a far-future HTTP-date and a huge delta-seconds value are both capped', () => {
    expect(parseRetryAfter('Fri, 01 Jan 2100 00:00:00 GMT')).toBe(86_400)
    expect(parseRetryAfter('999999999')).toBe(86_400)
  })

  test('absent or unparseable values yield undefined', () => {
    expect(parseRetryAfter(null)).toBeUndefined()
    expect(parseRetryAfter(undefined)).toBeUndefined()
    expect(parseRetryAfter('')).toBeUndefined()
    expect(parseRetryAfter('soon')).toBeUndefined()
  })
})
