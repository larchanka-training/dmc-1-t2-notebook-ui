import { connectLogger, log, wrap } from '@reatom/core'
import { rootFrame } from '@/setup'
import { setAuthTokenGetter, setRefreshHandlers } from '@/shared/api'
import { LOGIN_PATH } from '@/shared/lib/paths'
import { parsePersistRecord, readPersistRecord } from '@/shared/lib/persist'
import { accessTokenAtom, clearSession, refreshTokenAtom, userAtom } from '@/entities/session'
import { startThemeSync } from '@/entities/theme'
import { loadCurrentUserAction } from '@/features/auth'
import { loadNotebook, markBootRestored, startAutosave } from '@/features/notebook'

// #8 — one-time migration: the pre-OTP model stored a single JWT under
// 'session.token'. The new model uses 'session.accessToken' + 'session.refreshToken'.
// Existing sessions cannot be migrated (no refresh token, token may be expired).
// Remove the orphaned key so it doesn't accumulate in devtools storage.
if (typeof localStorage !== 'undefined') {
  localStorage.removeItem('session.token')
}

if (import.meta.env.MODE === 'development') {
  connectLogger()
}

declare global {
  var LOG: typeof log
}

globalThis.LOG = log

// ---------------------------------------------------------------------------
// Persist helpers
// ---------------------------------------------------------------------------

// Reatom's withLocalStorage (even in subscribe:false / withInit mode) does not
// eagerly initialise atoms from localStorage in action bodies — withInit fires
// as a withMiddleware hook, which only runs during a reactive computation, not
// during a plain action-body read at startup. We therefore seed atoms directly
// from localStorage (via the shared persist helpers) before any action runs.
const REFRESH_TOKEN_KEY = 'session.refreshToken'

type SessionUser = NonNullable<ReturnType<typeof userAtom>>

rootFrame.run(() => {
  const token = readPersistRecord<string>('session.accessToken')
  const refresh = readPersistRecord<string>(REFRESH_TOKEN_KEY)
  const user = readPersistRecord<SessionUser>('session.user')
  if (token !== null) accessTokenAtom.set(token)
  if (refresh !== null) refreshTokenAtom.set(refresh)
  if (user !== null) userAtom.set(user)
})

// ---------------------------------------------------------------------------
// HTTP client wiring
// ---------------------------------------------------------------------------

// Wire the API client's auth token source to the auth atom.
// This composition lives here so `shared/api` stays framework-agnostic.
setAuthTokenGetter(() => accessTokenAtom())

// Wire the refresh token handlers so the 401 middleware can silently rotate
// tokens and retry failed requests without involving UI code.
setRefreshHandlers({
  // Read the opaque refresh token straight from localStorage rather than via
  // refreshTokenAtom(). The 401 interceptor calls this from a detached async
  // continuation after `await fetch`, where the Reatom frame is off the stack
  // and a cold-atom read returns its init value (null) — so the live token in
  // storage would be missed and the user spuriously logged out. The token is
  // opaque (no reactivity needed), so the atom is not the source of truth here.
  // See .agents/issues/TARDIS-74/login-flow-issue.md.
  getRefreshToken: () => readPersistRecord<string>(REFRESH_TOKEN_KEY),
  onTokensRefreshed: (accessToken, refreshToken) => {
    // Persist + update atoms in a guaranteed Reatom frame so the rotated
    // refresh token is in localStorage before the retried request reads it.
    rootFrame.run(() => {
      accessTokenAtom.set(accessToken)
      refreshTokenAtom.set(refreshToken)
    })
  },
  onSessionExpired: () => {
    rootFrame.run(() => clearSession())
    if (window.location.pathname !== LOGIN_PATH) {
      window.location.replace(`${LOGIN_PATH}?reason=session_expired`)
    }
  },
})

// Restore session if a token was persisted from a previous run.
// `clearStack()` requires every action to run inside an active Reatom stack,
// so dispatch through rootFrame at module init.
rootFrame.run(() => loadCurrentUserAction())

// Keep <html> in sync with the resolved theme for the whole app lifetime.
// The subscription makes `resolvedThemeAtom` hot (so it recomputes on every
// mode switch or OS flip on ANY route, not only where NotebookView is
// mounted), and fires synchronously on subscribe to cover the first paint.
rootFrame.run(() => {
  startThemeSync()
})

// Restore the local notebook from IndexedDB, then begin autosaving. Order
// matters: load first so autosave's initial (synchronous) subscribe observes
// the restored content and its "skip first emit" guard avoids re-saving an
// unchanged notebook. Both live at app lifetime (not NotebookView mount) so a
// pending debounced save is never dropped by navigating to another route
// mid-edit. `loadNotebook` is async and dispatched through rootFrame under
// clearStack(), the same way the session restore above is.
//
// `startAutosave()` runs in `finally`: `loadNotebook` is best-effort and
// shouldn't reject, but should it ever throw, autosave must still start so a
// later edit can persist (and surface 'error' on the indicator) instead of
// being silently disabled for the whole session.
rootFrame.run(async () => {
  try {
    // A real restore (existing stored notebook) surfaces "Saved · <time>" right
    // away, seeded from the stored timestamp — instead of a blank indicator
    // until the first edit. A fresh seed / newer-format / failure returns false
    // and keeps the idle state.
    const restored = await wrap(loadNotebook())
    if (restored) markBootRestored()
  } finally {
    startAutosave()
  }
})

// ---------------------------------------------------------------------------
// Multi-tab sync
// ---------------------------------------------------------------------------

// withLocalStorage(subscribe:false) does not register storage event listeners,
// so we sync atoms manually here for cross-tab consistency.
window.addEventListener('storage', (e: StorageEvent) => {
  if (e.key === 'session.accessToken') {
    const newToken = parsePersistRecord<string>(e.newValue)
    rootFrame.run(() => accessTokenAtom.set(newToken))
    if (!newToken && window.location.pathname !== LOGIN_PATH) {
      window.location.replace(LOGIN_PATH)
    }
  }
  if (e.key === 'session.refreshToken') {
    const newRefresh = parsePersistRecord<string>(e.newValue)
    rootFrame.run(() => refreshTokenAtom.set(newRefresh))
  }
  if (e.key === 'session.user') {
    const newUser = parsePersistRecord<SessionUser>(e.newValue)
    rootFrame.run(() => userAtom.set(newUser))
  }
})
