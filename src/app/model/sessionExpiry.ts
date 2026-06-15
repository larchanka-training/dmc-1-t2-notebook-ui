// Hard end-of-session handling, extracted from setup.ts so the auth↔sync seam is
// unit-testable without the boot module's import side effects (review M-9).

import { rootFrame } from '@/setup'
import { clearSession } from '@/entities/session'
import { pauseRemoteSync, resetSlotToFloorForAccountChange } from '@/features/notebook'
import { LOGIN_PATH } from '@/shared/lib/paths'

/**
 * Called when the refresh token is also dead (the API client's `onSessionExpired`).
 * Pause background sync and clear the session WITHOUT wiping local notebook data
 * (INV-4 — an untrusted-device wipe is #136), then redirect to login. This is the
 * single integration point where auth meets sync (AC5/AC6).
 */
export function handleSessionExpired(): void {
  rootFrame.run(() => {
    pauseRemoteSync()
    clearSession()
    void resetSlotToFloorForAccountChange()
  })
  if (window.location.pathname !== LOGIN_PATH) {
    window.location.replace(`${LOGIN_PATH}?reason=session_expired`)
  }
}
