import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Use the REAL remote-sync engine (so this proves handleSessionExpired actually
// pauses it — review opus M1), but mock the things we can't run here:
//  - `@/setup`'s rootFrame, whose real module calls clearStack() at import and
//    would break the shared context.reset();
//  - `clearSession`, so we can assert it is invoked without real session machinery;
//  - `resetSlotToFloorForAccountChange`, so we can assert handleSessionExpired does
//    NOT trigger the slot reset directly (it is owned by startNotebookListSync's
//    owner-change subscription — review H3, no double reset).
const clearSessionMock = vi.fn()
const resetSlotMock = vi.fn()

vi.mock('@/setup', () => ({ rootFrame: { run: (fn: () => void) => fn() } }))
vi.mock('@/entities/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/entities/session')>()),
  clearSession: () => clearSessionMock(),
}))
vi.mock('@/features/notebook', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/notebook')>()),
  resetSlotToFloorForAccountChange: () => resetSlotMock(),
}))

import { remoteSyncStatusAtom } from '@/features/notebook'
import { LOGIN_PATH } from '@/shared/lib/paths'
import { handleSessionExpired } from './sessionExpiry'

describe('handleSessionExpired (real auth↔sync seam, AC5/AC6)', () => {
  beforeEach(() => {
    clearSessionMock.mockClear()
    resetSlotMock.mockClear()
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

  test('does NOT reset the slot directly — the owner-change subscription owns it (H3)', () => {
    // clearSession() nulls userAtom, which startNotebookListSync observes and uses
    // to reset the slot once. handleSessionExpired must not reset it a second time,
    // or two concurrent lock-free resets run and a fresh remote-sync engine is
    // re-armed right after pauseRemoteSync.
    handleSessionExpired()
    expect(resetSlotMock).not.toHaveBeenCalled()
  })
})
