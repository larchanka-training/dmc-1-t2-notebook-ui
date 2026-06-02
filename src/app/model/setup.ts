import { connectLogger, log } from '@reatom/core'
import { rootFrame } from '@/setup'
import { setAuthTokenGetter, setRefreshHandlers } from '@/shared/api'
import { accessTokenAtom, clearSession, refreshTokenAtom, userAtom } from '@/entities/session'
import { themeAtom } from '@/entities/theme'
import { loadCurrentUserAction } from '@/features/auth'

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
// from localStorage before any action runs.
function readPersistRecord<T>(key: string): T | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const rec = JSON.parse(raw) as { data?: T | null; to?: number }
    // Respect the Reatom TTL field so expired entries are treated as absent.
    if (typeof rec.to === 'number' && rec.to < Date.now()) {
      localStorage.removeItem(key)
      return null
    }
    return rec.data ?? null
  } catch {
    return null
  }
}

type SessionUser = NonNullable<ReturnType<typeof userAtom>>

rootFrame.run(() => {
  const token = readPersistRecord<string>('session.accessToken')
  const refresh = readPersistRecord<string>('session.refreshToken')
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
  getRefreshToken: () => refreshTokenAtom(),
  onTokensRefreshed: (accessToken, refreshToken) => {
    rootFrame.run(() => {
      accessTokenAtom.set(accessToken)
      refreshTokenAtom.set(refreshToken)
    })
  },
  onSessionExpired: () => {
    rootFrame.run(() => clearSession())
    if (window.location.pathname !== '/login') {
      window.location.replace('/login?reason=session_expired')
    }
  },
})

// Restore session if a token was persisted from a previous run.
// `clearStack()` requires every action to run inside an active Reatom stack,
// so dispatch through rootFrame at module init.
rootFrame.run(() => loadCurrentUserAction())

// Apply the persisted theme on first load. themeAtom's withChangeHook handles
// subsequent changes when the user toggles the theme.
rootFrame.run(() => {
  document.documentElement.classList.toggle('dark', themeAtom() === 'dark')
})

// ---------------------------------------------------------------------------
// Multi-tab sync
// ---------------------------------------------------------------------------

// withLocalStorage(subscribe:false) does not register storage event listeners,
// so we sync atoms manually here for cross-tab consistency.
function parsePersistRecord<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return (JSON.parse(raw) as { data?: T | null }).data ?? null
  } catch {
    return null
  }
}

window.addEventListener('storage', (e: StorageEvent) => {
  if (e.key === 'session.accessToken') {
    const newToken = parsePersistRecord<string>(e.newValue)
    rootFrame.run(() => accessTokenAtom.set(newToken))
    if (!newToken && window.location.pathname !== '/login') {
      window.location.replace('/login')
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
