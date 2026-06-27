// Echo-safe cross-tab session synchronisation.
//
// The session atoms persist via `withLocalStorage({ subscribe: false })`, so they
// do NOT register their own `storage` listeners — cross-tab propagation is wired
// here, in ONE place (the "single point of auth-state observation").
//
// Why this is not a plain `atom.set(parsePersistRecord(...))` on every event
// (the previous setup.ts handler, which caused the logout flicker between tabs):
//   - `*Atom` are PERSISTED atoms, so any `.set` writes a fresh localStorage
//     record. Reatom's `toPersistRecord` stamps each write with `id: random()`
//     and a new `timestamp`/`to`, so the serialized string differs EVERY time,
//     even when the logical value is unchanged.
//   - that write fires a `storage` event in the other tab, which `.set`s, which
//     writes a new record, which fires back — an infinite ping-pong, visible as
//     the value (and its TTL) churning in localStorage and the UI flickering
//     between the login form and the signed-in view in both tabs.
//
// The fix: apply an incoming value ONLY when it differs from the current atom
// state by VALUE (`isDeepEqual`, not reference). An equal value is a no-op, so it
// neither re-writes localStorage nor emits another event — the echo dies after a
// single hop. The redirect-to-login on a cross-tab sign-out lives here too, so
// all cross-tab session reactions have one owner.

import { isDeepEqual } from '@reatom/core'
import { rootFrame } from '@/setup'
import { parsePersistRecord } from '@/shared/lib/persist'
import { LOGIN_PATH } from '@/shared/lib/paths'
import {
  accessTokenAtom,
  refreshTokenAtom,
  userAtom,
  SESSION_STORAGE_KEYS,
  type SessionUser,
} from './session'

/**
 * Apply an incoming cross-tab value to a persisted atom only if it actually
 * changed. Returns whether a change was applied (so the caller can react, e.g.
 * redirect on sign-out). Runs the comparison + set inside `rootFrame` so the
 * atom read/write are in-frame.
 */
function applyIfChanged<T>(atom: { (): T; set: (value: T) => void }, next: T): boolean {
  return rootFrame.run(() => {
    if (isDeepEqual(atom(), next)) return false
    atom.set(next)
    return true
  })
}

/**
 * Start the single cross-tab session listener. Returns an unsubscribe handle.
 * Mirrors `session.accessToken` / `session.refreshToken` / `session.user`
 * between tabs of the same origin, echo-safely (see file header), and redirects
 * to /login when another tab signs out.
 */
export function startSessionCrossTabSync(): () => void {
  const handler = (e: StorageEvent) => {
    switch (e.key) {
      case SESSION_STORAGE_KEYS.accessToken: {
        const next = parsePersistRecord<string>(e.newValue)
        const changed = applyIfChanged(accessTokenAtom, next)
        // Another tab signed out (token cleared): leave any protected route.
        if (changed && next === null && window.location.pathname !== LOGIN_PATH) {
          window.location.replace(LOGIN_PATH)
        }
        break
      }
      case SESSION_STORAGE_KEYS.refreshToken: {
        applyIfChanged(refreshTokenAtom, parsePersistRecord<string>(e.newValue))
        break
      }
      case SESSION_STORAGE_KEYS.user: {
        applyIfChanged(userAtom, parsePersistRecord<SessionUser>(e.newValue))
        break
      }
    }
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}
