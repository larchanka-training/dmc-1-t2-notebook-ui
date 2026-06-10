import { describe, expect, test } from 'vitest'
import { ApiError, BadRequestError, NotFoundError, UnauthorizedError, toApiError } from './errors'

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
