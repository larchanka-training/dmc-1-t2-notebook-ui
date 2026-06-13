import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Use the REAL remote-sync engine (so this proves handleSessionExpired actually
// pauses it — review opus M1), but mock the two things we can't run here:
//  - `@/setup`'s rootFrame, whose real module calls clearStack() at import and
//    would break the shared context.reset();
//  - `clearSession`, so we can assert it is invoked without real session machinery.
const clearSessionMock = vi.fn()

vi.mock('@/setup', () => ({ rootFrame: { run: (fn: () => void) => fn() } }))
vi.mock('@/entities/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/entities/session')>()),
  clearSession: () => clearSessionMock(),
}))

import { remoteSyncStatusAtom } from '@/features/notebook'
import { LOGIN_PATH } from '@/shared/lib/paths'
import { handleSessionExpired } from './sessionExpiry'

describe('handleSessionExpired (real auth↔sync seam, AC5/AC6)', () => {
  beforeEach(() => {
    clearSessionMock.mockClear()
    remoteSyncStatusAtom.set('idle')
    // Sit on the login route so the redirect branch is a no-op (no navigation).
    window.history.pushState({}, '', LOGIN_PATH)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    remoteSyncStatusAtom.set('idle')
  })

  test('pauses the REAL remote-sync engine and clears the session', () => {
    handleSessionExpired()
    // The real pauseRemoteSync ran (status moved to 'paused') — not a mock by name.
    expect(remoteSyncStatusAtom()).toBe('paused')
    expect(clearSessionMock).toHaveBeenCalledTimes(1)
  })
})
