import createClient, { type Middleware } from 'openapi-fetch'
import type { paths as AuthPaths } from './generated/openapi-ts/auth'
import type { paths as NotebookPaths } from './generated/openapi-ts/notebook'

const rawBaseUrl = import.meta.env['VITE_API_BASE_URL'] ?? '/api'

// `openapi-fetch` builds a `Request` whose URL constructor refuses relative paths
// in Node/jsdom. In a browser-like environment we anchor the path to the current
// origin; outside of one we leave it as-is and let `fetch` resolve it.
const baseUrl =
  rawBaseUrl.startsWith('/') && typeof window !== 'undefined' && window.location?.origin
    ? `${window.location.origin}${rawBaseUrl}`
    : rawBaseUrl

// ---------------------------------------------------------------------------
// Auth token injection
// ---------------------------------------------------------------------------

let getAuthToken: () => string | null = () => null

export function setAuthTokenGetter(getter: () => string | null): void {
  getAuthToken = getter
}

// ---------------------------------------------------------------------------
// Refresh token injection
// ---------------------------------------------------------------------------

let getRefreshToken: () => string | null = () => null
let onTokensRefreshed: (accessToken: string, refreshToken: string) => void = () => {}
let onSessionExpired: () => void = () => {}

export function setRefreshHandlers(opts: {
  getRefreshToken: () => string | null
  onTokensRefreshed: (accessToken: string, refreshToken: string) => void
  onSessionExpired: () => void
}): void {
  getRefreshToken = opts.getRefreshToken
  onTokensRefreshed = opts.onTokensRefreshed
  onSessionExpired = opts.onSessionExpired
}

// ---------------------------------------------------------------------------
// Single-flight refresh
// ---------------------------------------------------------------------------

let refreshInFlight: Promise<void> | null = null

function refreshOnce(): Promise<void> {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = doRefresh().finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}

async function doRefresh(): Promise<void> {
  const token = getRefreshToken()
  if (!token) {
    onSessionExpired()
    throw new Error('no_refresh_token')
  }
  // Use lateBoundFetch directly — bypasses openapi-fetch clients and their
  // middleware, so this call cannot re-enter the 401 interceptor.
  const res = await lateBoundFetch(`${baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: token }),
  })
  if (!res.ok) {
    onSessionExpired()
    throw new Error('refresh_failed')
  }
  // #6 — runtime shape validation: TypeScript cast is not a runtime check.
  // A malformed response would store undefined into atoms, breaking the session
  // silently instead of redirecting to login.
  const raw = (await res.json()) as unknown
  if (
    typeof raw !== 'object' ||
    raw === null ||
    typeof (raw as Record<string, unknown>).accessToken !== 'string' ||
    typeof (raw as Record<string, unknown>).refreshToken !== 'string'
  ) {
    onSessionExpired()
    throw new Error('malformed_refresh_response')
  }
  const data = raw as { accessToken: string; refreshToken: string }
  onTokensRefreshed(data.accessToken, data.refreshToken)
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

const authMiddleware: Middleware = {
  async onRequest({ request }) {
    const token = getAuthToken()
    if (token) request.headers.set('Authorization', `Bearer ${token}`)
    return request
  },
}

// #2 — Request.body is a ReadableStream that is consumed by the first fetch().
// We snapshot it as text in onRequest (before fetch runs) so the refresh retry
// can re-send the same body without a "disturbed stream" error.
const requestBodyCache = new WeakMap<Request, string | null>()

const bodyBufferMiddleware: Middleware = {
  async onRequest({ request }) {
    requestBodyCache.set(request, request.body ? await request.clone().text() : null)
    return request
  },
}

const refreshMiddleware: Middleware = {
  async onResponse({ request, response }) {
    if (response.status !== 401) return response

    try {
      await refreshOnce()
    } catch {
      // Refresh failed; onSessionExpired() was already called.
      return response
    }

    const newToken = getAuthToken()
    if (!newToken) return response

    // Retry the original request with the fresh access token.
    // lateBoundFetch bypasses the middleware, avoiding re-entry.
    // Uses the pre-buffered body so the consumed stream is not re-read.
    return lateBoundFetch(request.url, {
      method: request.method,
      headers: {
        ...Object.fromEntries(request.headers.entries()),
        Authorization: `Bearer ${newToken}`,
      },
      body: requestBodyCache.get(request) ?? null,
      credentials: request.credentials,
    })
  },
}

const lateBoundFetch: typeof fetch = (...args) => globalThis.fetch(...args)

export const authClient = createClient<AuthPaths>({ baseUrl, fetch: lateBoundFetch })
authClient.use(authMiddleware)
authClient.use(bodyBufferMiddleware)
authClient.use(refreshMiddleware)

export const notebookClient = createClient<NotebookPaths>({ baseUrl, fetch: lateBoundFetch })
notebookClient.use(authMiddleware)
notebookClient.use(bodyBufferMiddleware)
notebookClient.use(refreshMiddleware)
