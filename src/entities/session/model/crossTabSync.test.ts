import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// `@/setup`'s real module calls clearStack() at import and owns the production
// rootFrame, which would fight the shared `context.reset()` in test setup. Mock
// it so `rootFrame.run(fn)` runs `fn` in the test's ambient frame (same pattern
// as sessionExpiry.test.ts).
vi.mock('@/setup', () => ({ rootFrame: { run: (fn: () => unknown) => fn() } }))

import { accessTokenAtom, userAtom, clearSession, SESSION_STORAGE_KEYS } from './session'
import { startSessionCrossTabSync } from './crossTabSync'

// Build the `{ data }` shape `parsePersistRecord` expects from a StorageEvent's
// newValue, with the volatile fields (id/timestamp/to) that reatom's persist
// stamps on every write — so two records with the SAME logical value still have
// DIFFERENT serialized strings. This is exactly what made the previous handler
// echo forever.
function record<T>(data: T): string {
  return JSON.stringify({ data, id: Math.random(), timestamp: Date.now(), to: Date.now() + 1e9 })
}

function emitStorage(key: string, newValue: string | null): void {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }))
}

describe('startSessionCrossTabSync (echo-safe cross-tab session)', () => {
  let stop: () => void
  let replaceSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    clearSession()
    stop = startSessionCrossTabSync()
    replaceSpy = vi.fn()
    vi.stubGlobal('location', { replace: replaceSpy, pathname: '/protected' })
  })

  afterEach(() => {
    stop()
    clearSession()
    vi.unstubAllGlobals()
  })

  test('applies a changed user value from another tab', () => {
    const user = { id: 'u1', email: 'a@b.com', displayName: null, roles: [] }
    emitStorage(SESSION_STORAGE_KEYS.user, record(user))
    expect(userAtom()).toEqual(user)
  })

  test('an equal value does NOT re-set the atom (echo dies after one hop)', () => {
    const user = { id: 'u1', email: 'a@b.com', displayName: null, roles: [] }
    userAtom.set(user)
    const setSpy = vi.spyOn(userAtom, 'set')

    // A second tab echoes the SAME logical value but with a fresh record string.
    emitStorage(SESSION_STORAGE_KEYS.user, record({ ...user }))

    // No re-set → no new localStorage write → no event bounced back.
    expect(setSpy).not.toHaveBeenCalled()
  })

  test('a cross-tab sign-out (token cleared) clears the atom and redirects to login', () => {
    accessTokenAtom.set('tok')

    emitStorage(SESSION_STORAGE_KEYS.accessToken, null)

    expect(accessTokenAtom()).toBeNull()
    expect(replaceSpy).toHaveBeenCalledTimes(1)
  })

  test('does not redirect when the cleared token was already null (no spurious nav)', () => {
    emitStorage(SESSION_STORAGE_KEYS.accessToken, null)
    expect(replaceSpy).not.toHaveBeenCalled()
  })

  test('stops listening after the returned unsubscribe', () => {
    stop()
    const user = { id: 'u2', email: 'c@d.com', displayName: null, roles: [] }
    emitStorage(SESSION_STORAGE_KEYS.user, record(user))
    expect(userAtom()).toBeNull()
  })
})
