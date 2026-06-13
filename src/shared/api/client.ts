import createClient, { type Middleware } from 'openapi-fetch'
import type { paths as AuthPaths } from './generated/openapi-ts/auth'
import type { paths as LlmPaths } from './generated/openapi-ts/llm'
import type { paths as NotebookPaths } from './generated/openapi-ts/notebook'

const rawBaseUrl = import.meta.env['VITE_API_BASE_URL'] ?? '/api/v1'

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
  // A sign-out / session-expiry cleanup can clear or rotate the refresh token
  // while this request is in flight. A stale response must not repopulate a
  // session the app has already torn down.
  if (getRefreshToken() !== token) throw new Error('stale_refresh_response')
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

// #2 — Request.body is a one-shot ReadableStream consumed by the first fetch(),
// so the refresh retry needs a copy taken before fetch runs.
// OOP-1: snapshot a synchronous clone() — no await, no eager string decode on
// the hot success path; clone() tees the body so the copy survives the original
// being consumed by the network.
// The .text() decode is deferred to the rare 401 retry below.
const requestBodyCache = new WeakMap<Request, Request>()

const bodyBufferMiddleware: Middleware = {
  onRequest({ request }) {
    if (request.body) requestBodyCache.set(request, request.clone())
    return request
  },
}

const refreshMiddleware: Middleware = {
  async onResponse({ request, response }) {
    if (response.status !== 401) return response

    // Cancellation must survive the refresh hop. The caller (e.g. remoteSync's
    // per-push AbortController) threads `signal` through the facade onto this
    // Request; a sign-out / teardown / session-expiry pause aborts it. Without
    // this guard the refresh-and-retry below would issue a fresh POST/PATCH after
    // the caller gave up — landing a mutation under a torn-down session (gpt-v-7
    // B-1). Check both before and after the refresh await (the abort can land
    // mid-refresh), and thread the signal into the retry so it stays cancellable.
    if (request.signal?.aborted) return response

    try {
      await refreshOnce()
    } catch {
      // Refresh failed; onSessionExpired() was already called.
      return response
    }

    if (request.signal?.aborted) return response

    const newToken = getAuthToken()
    if (!newToken) return response

    // Retry the original request with the fresh access token.
    // lateBoundFetch bypasses the middleware, avoiding re-entry.
    // Decode the pre-cloned body to text only here (rare path), so the original
    // consumed stream is never re-read.
    const buffered = requestBodyCache.get(request)
    // Clone the original headers and overwrite Authorization via Headers.set,
    // which is case-insensitive. A plain object spread would keep the original
    // lowercase `authorization` next to a new `Authorization`, and fetch would
    // then merge the stale and fresh tokens into one comma-joined bearer header.
    const retryHeaders = new Headers(request.headers)
    retryHeaders.set('Authorization', `Bearer ${newToken}`)
    return lateBoundFetch(request.url, {
      method: request.method,
      headers: retryHeaders,
      body: buffered ? await buffered.text() : null,
      credentials: request.credentials,
      signal: request.signal,
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

export const llmClient = createClient<LlmPaths>({ baseUrl, fetch: lateBoundFetch })
llmClient.use(authMiddleware)
llmClient.use(bodyBufferMiddleware)
llmClient.use(refreshMiddleware)
