import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Replace only the two collaborators we assert on; keep everything else real so
// the module (and rootFrame) loads normally.
const pauseRemoteSyncMock = vi.fn()
const clearSessionMock = vi.fn()

// Stub rootFrame so the real `@/setup` (which calls clearStack() at import and
// would break the shared context.reset()) is never loaded; run the callback directly.
vi.mock('@/setup', () => ({ rootFrame: { run: (fn: () => void) => fn() } }))
vi.mock('@/features/notebook', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/notebook')>()),
  pauseRemoteSync: () => pauseRemoteSyncMock(),
}))
vi.mock('@/entities/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/entities/session')>()),
  clearSession: () => clearSessionMock(),
}))

import { LOGIN_PATH } from '@/shared/lib/paths'
import { handleSessionExpired } from './sessionExpiry'

describe('handleSessionExpired (auth↔sync seam, AC5/AC6)', () => {
  beforeEach(() => {
    pauseRemoteSyncMock.mockClear()
    clearSessionMock.mockClear()
    // Sit on the login route so the redirect branch is a no-op (no navigation).
    window.history.pushState({}, '', LOGIN_PATH)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('pauses remote sync and clears the session (no local-data wipe)', () => {
    handleSessionExpired()
    expect(pauseRemoteSyncMock).toHaveBeenCalledTimes(1)
    expect(clearSessionMock).toHaveBeenCalledTimes(1)
  })
})
