// Cross-origin isolation (COOP/COEP) for the dev server.
//
// These headers put the page into a "cross-origin isolated" context, the
// precondition for `SharedArrayBuffer`. The execution runtime uses a SAB to
// interrupt a blocked QuickJS VM (Stop / Stop All) WITHOUT tearing down the
// worker, so the shared scope survives a stop. Without isolation the runtime
// degrades to terminating the worker (correct, but loses scope on Stop).
//
// Production serves the same headers from nginx (see `proxy/nginx.prod.conf`).
// Extracted into its own module so the header contract is unit-testable
// (see coiPlugin.test.ts) instead of buried in vite.config.ts.

/** The exact headers required for cross-origin isolation. */
export const COI_HEADERS: Readonly<Record<string, string>> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

interface CoiResponse {
  setHeader: (name: string, value: string) => void
}

type CoiMiddleware = (req: unknown, res: CoiResponse, next: () => void) => void

/** Apply the COI headers to a response, then continue the middleware chain. */
export function applyCoiHeaders(res: CoiResponse, next: () => void): void {
  for (const [name, value] of Object.entries(COI_HEADERS)) {
    res.setHeader(name, value)
  }
  next()
}

/** Vite plugin that sets the COI headers on every dev-server response. */
export const crossOriginIsolation = {
  name: 'cross-origin-isolation',
  configureServer(server: { middlewares: { use: (fn: CoiMiddleware) => void } }) {
    server.middlewares.use((_req, res, next) => applyCoiHeaders(res, next))
  },
}
