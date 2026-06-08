import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { setAuthTokenGetter } from './client'
import * as llm from './llm'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

let fetchMock: ReturnType<typeof vi.fn>

function lastRequest(): Request {
  return fetchMock.mock.calls.at(-1)![0] as Request
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  setAuthTokenGetter(() => null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LLM API', () => {
  test('sends generate request through the shared authenticated client', async () => {
    setAuthTokenGetter(() => 'access-token')
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        resultKind: 'code',
        content: 'const value = 1;',
        model: 'fake-model',
        tier: 'backend',
        tokens: { prompt: 10, completion: 5 },
        requestId: '11111111-1111-1111-1111-111111111111',
      }),
    )

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
