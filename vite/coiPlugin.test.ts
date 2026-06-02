import { describe, expect, test, vi } from 'vitest'
import { applyCoiHeaders, COI_HEADERS, crossOriginIsolation } from './coiPlugin'

// Smoke-level guard for the cross-origin isolation contract. A full browser
// check (crossOriginIsolated === true + a live SAB interrupt) needs an E2E
// runner; here we pin that the dev server WILL emit the exact COOP/COEP pair
// the SharedArrayBuffer-backed Stop depends on. Production parity lives in
// proxy/nginx.prod.conf.

describe('cross-origin isolation headers', () => {
  test('the contract is exactly COOP=same-origin + COEP=require-corp', () => {
    expect(COI_HEADERS).toEqual({
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    })
  })

  test('applyCoiHeaders sets both headers and calls next exactly once', () => {
    const setHeader = vi.fn()
    const next = vi.fn()
    applyCoiHeaders({ setHeader }, next)
    expect(setHeader).toHaveBeenCalledWith('Cross-Origin-Opener-Policy', 'same-origin')
    expect(setHeader).toHaveBeenCalledWith('Cross-Origin-Embedder-Policy', 'require-corp')
    expect(setHeader).toHaveBeenCalledTimes(2)
    expect(next).toHaveBeenCalledTimes(1)
  })

  test('the plugin registers a middleware that emits the headers', () => {
    const setHeader = vi.fn()
    const next = vi.fn()
    let registered: ((req: unknown, res: unknown, next: () => void) => void) | null = null
    const server = {
      middlewares: {
        use: (fn: (req: unknown, res: unknown, next: () => void) => void) => {
          registered = fn
        },
      },
    }
    crossOriginIsolation.configureServer(server)
    expect(registered).not.toBeNull()
    registered!({}, { setHeader }, next)
    expect(setHeader).toHaveBeenCalledTimes(2)
    expect(next).toHaveBeenCalledTimes(1)
  })
})
