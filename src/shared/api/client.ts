import createClient, { type Middleware } from 'openapi-fetch'
import type { paths as AuthPaths } from './generated/openapi-ts/auth'
import type { paths as NotebookPaths } from './generated/openapi-ts/notebook'

const baseUrl =
  import.meta.env['VITE_API_BASE_URL'] ??
  (typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api')

let getAuthToken: () => string | null = () => null

export function setAuthTokenGetter(getter: () => string | null): void {
  getAuthToken = getter
}

const authMiddleware: Middleware = {
  async onRequest({ request }) {
    const token = getAuthToken()
    if (token) request.headers.set('Authorization', `Bearer ${token}`)
    return request
  },
}

const lateBoundFetch: typeof fetch = (...args) => globalThis.fetch(...args)

export const authClient = createClient<AuthPaths>({ baseUrl, fetch: lateBoundFetch })
authClient.use(authMiddleware)

export const notebookClient = createClient<NotebookPaths>({ baseUrl, fetch: lateBoundFetch })
notebookClient.use(authMiddleware)
