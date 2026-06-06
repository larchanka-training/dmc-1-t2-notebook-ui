import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { authClient, setAuthTokenGetter, setRefreshHandlers } from './client'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const stubUser = { id: 'u1', email: 'a@b.com', roles: [] }
const stubTokens = { accessToken: 'new-access', refreshToken: 'new-refresh' }

let fetchMock: ReturnType<typeof vi.fn>
let onTokensRefreshed: ReturnType<typeof vi.fn>
let onSessionExpired: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)

  onTokensRefreshed = vi.fn((accessToken: string) => {
    // Simulate what setup.ts does: update the token getter after refresh.
    setAuthTokenGetter(() => accessToken)
  })
  onSessionExpired = vi.fn()

  setAuthTokenGetter(() => 'initial-access')
  setRefreshHandlers({
    getRefreshToken: () => 'current-refresh',
    onTokensRefreshed: onTokensRefreshed as (a: string, r: string) => void,
    onSessionExpired: onSessionExpired as () => void,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  // Reset to safe defaults so other test suites are not affected.
  setAuthTokenGetter(() => null)
  setRefreshHandlers({
    getRefreshToken: () => null,
    onTokensRefreshed: () => {},
    onSessionExpired: () => {},
  })
})

describe('refresh middleware', () => {
  test('on 401: refreshes tokens and retries with new access token', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { code: 'unauthorized', message: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(200, stubTokens)) // refresh call
      .mockResolvedValueOnce(jsonResponse(200, stubUser)) // retry

    const { data } = await authClient.GET('/auth/me')

    expect(onTokensRefreshed).toHaveBeenCalledWith(stubTokens.accessToken, stubTokens.refreshToken)
    expect(data).toEqual(stubUser)
    // Three fetch calls: original → refresh → retry
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  test('on 401 + refresh failure (non-200): calls onSessionExpired', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { code: 'unauthorized', message: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(401, { code: 'refresh_expired', message: 'expired' }))

    await authClient.GET('/auth/me')

    expect(onSessionExpired).toHaveBeenCalledTimes(1)
    expect(onTokensRefreshed).not.toHaveBeenCalled()
  })

  test('on 401 with no refresh token: calls onSessionExpired without fetching refresh', async () => {
    setRefreshHandlers({
      getRefreshToken: () => null,
      onTokensRefreshed: onTokensRefreshed as (a: string, r: string) => void,
      onSessionExpired: onSessionExpired as () => void,
    })
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { code: 'unauthorized', message: '' }))

    await authClient.GET('/auth/me')

    expect(onSessionExpired).toHaveBeenCalledTimes(1)
    // Only the original request — no refresh fetch
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('single-flight: two concurrent 401s produce only one refresh call', async () => {
    let resolveRefresh!: (r: Response) => void
    const refreshHeld = new Promise<Response>((resolve) => {
      resolveRefresh = resolve
    })

    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {})) // first request → 401
      .mockResolvedValueOnce(jsonResponse(401, {})) // second request → 401
      .mockReturnValueOnce(refreshHeld) // refresh (held until we resolve)
      .mockResolvedValueOnce(jsonResponse(200, stubUser)) // retry of first
      .mockResolvedValueOnce(jsonResponse(200, stubUser)) // retry of second

    const first = authClient.GET('/auth/me')
    const second = authClient.GET('/auth/me')

    // Let both requests hit 401 and queue behind refreshInFlight, then resolve refresh.
    await Promise.resolve()
    resolveRefresh(jsonResponse(200, stubTokens))

    await Promise.all([first, second])

    const refreshCallCount = fetchMock.mock.calls.filter((args) => {
      const url = String(args[0] instanceof Request ? args[0].url : args[0])
      return url.includes('/auth/refresh')
    }).length
    expect(refreshCallCount).toBe(1)
  })

  test('on 401 + malformed refresh response: calls onSessionExpired', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(200, { wrong: 'shape' })) // missing accessToken/refreshToken

    await authClient.GET('/auth/me')

    expect(onSessionExpired).toHaveBeenCalledTimes(1)
    expect(onTokensRefreshed).not.toHaveBeenCalled()
  })

  test('non-401 response passes through unchanged', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, stubUser))

    const { data } = await authClient.GET('/auth/me')

    expect(data).toEqual(stubUser)
    expect(onSessionExpired).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
