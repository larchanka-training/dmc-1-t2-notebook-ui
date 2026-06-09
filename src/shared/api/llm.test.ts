import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { setAuthTokenGetter } from './client'
import { ApiError, BadRequestError, RateLimitedError, UnauthorizedError } from './errors'
import * as llm from './llm'

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

let fetchMock: ReturnType<typeof vi.fn>

function lastRequest(): Request {
  return fetchMock.mock.calls.at(-1)![0] as Request
}

async function lastRequestBody(): Promise<Record<string, unknown>> {
  return JSON.parse(await lastRequest().text())
}

function successResponse() {
  return jsonResponse(200, {
    resultKind: 'code',
    content: 'const value = 1;',
    model: 'fake-model',
    tier: 'backend',
    tokens: { prompt: 10, completion: 5 },
    requestId: '11111111-1111-1111-1111-111111111111',
  })
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  setAuthTokenGetter(() => null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LLM API — happy path', () => {
  test('sends generate request through the shared authenticated client', async () => {
    setAuthTokenGetter(() => 'access-token')
    fetchMock.mockResolvedValueOnce(successResponse())

    const response = await llm.generateCode({
      prompt: 'make a constant',
      context: [{ kind: 'code', source: 'const seed = 1;' }],
    })

    expect(response.content).toBe('const value = 1;')
    expect(lastRequest().method).toBe('POST')
    expect(lastRequest().url).toContain('/api/v1/llm/generate')
    expect(lastRequest().headers.get('authorization')).toBe('Bearer access-token')
  })
})

describe('LLM API — request body defaults (U3)', () => {
  test('injects context/language/mode defaults when caller omits them', async () => {
    fetchMock.mockResolvedValueOnce(successResponse())
    await llm.generateCode({ prompt: 'p' })

    const body = await lastRequestBody()
    expect(body).toMatchObject({
      prompt: 'p',
      context: [],
      language: 'javascript',
      mode: 'generate',
    })
  })

  test('honours caller-supplied context/language/mode values', async () => {
    fetchMock.mockResolvedValueOnce(successResponse())
    await llm.generateCode({
      prompt: 'p',
      context: [{ kind: 'markdown', source: 'note' }],
      language: 'typescript',
      mode: 'edit',
      baseCode: 'const x = 1;',
    })

    const body = await lastRequestBody()
    expect(body).toMatchObject({
      prompt: 'p',
      context: [{ kind: 'markdown', source: 'note' }],
      language: 'typescript',
      mode: 'edit',
      baseCode: 'const x = 1;',
    })
  })

  test('explicit undefined from caller does not overwrite default (U4)', async () => {
    fetchMock.mockResolvedValueOnce(successResponse())
    await llm.generateCode({
      prompt: 'p',
      language: undefined,
      mode: undefined,
      context: undefined,
    })

    const body = await lastRequestBody()
    expect(body.language).toBe('javascript')
    expect(body.mode).toBe('generate')
    expect(body.context).toEqual([])
  })
})

describe('LLM API — error contract (U3)', () => {
  test('throws BadRequestError for 400', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { error: { code: 'invalid_payload', message: 'bad' } }),
    )

    await expect(llm.generateCode({ prompt: 'p' })).rejects.toBeInstanceOf(BadRequestError)
  })

  test('throws UnauthorizedError for 401', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { code: 'invalid_token', message: 'no' } }),
    )

    await expect(llm.generateCode({ prompt: 'p' })).rejects.toBeInstanceOf(UnauthorizedError)
  })

  test('throws ApiError for 502 with backend error code preserved', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(502, { error: { code: 'llm_provider_error', message: 'down' } }),
    )

    let caught: unknown
    try {
      await llm.generateCode({ prompt: 'p' })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(502)
    expect((caught as ApiError).code).toBe('llm_provider_error')
  })
})

describe('LLM API — Retry-After surfacing (U2)', () => {
  test('throws RateLimitedError with parsed retryAfter for 429', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        429,
        { error: { code: 'rate_limited', message: 'slow down' } },
        { 'retry-after': '37' },
      ),
    )

    let caught: unknown
    try {
      await llm.generateCode({ prompt: 'p' })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(RateLimitedError)
    expect((caught as RateLimitedError).retryAfter).toBe(37)
    expect((caught as RateLimitedError).code).toBe('rate_limited')
  })

  test('RateLimitedError.retryAfter is undefined when header missing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: { code: 'rate_limited' } }))

    let caught: unknown
    try {
      await llm.generateCode({ prompt: 'p' })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(RateLimitedError)
    expect((caught as RateLimitedError).retryAfter).toBeUndefined()
  })

  test('malformed Retry-After header yields undefined retryAfter', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(429, { error: { code: 'rate_limited' } }, { 'retry-after': 'tomorrow' }),
    )

    let caught: unknown
    try {
      await llm.generateCode({ prompt: 'p' })
    } catch (err) {
      caught = err
    }
    expect((caught as RateLimitedError).retryAfter).toBeUndefined()
  })
})
