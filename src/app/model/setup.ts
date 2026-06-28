import { connectLogger, log, urlAtom, wrap } from '@reatom/core'
import { rootFrame } from '@/setup'
import { setAuthTokenGetter, setRefreshHandlers } from '@/shared/api'
import { appPath } from '@/shared/lib/paths'
import { readPersistRecord } from '@/shared/lib/persist'
import {
  accessTokenAtom,
  refreshTokenAtom,
  userAtom,
  authStatusAtom,
  SESSION_STORAGE_KEYS,
  type SessionUser,
} from '@/entities/session'
import { startSessionCrossTabSync } from '@/entities/session/model/crossTabSync'
import { startThemeSync } from '@/entities/theme'
import { loadCurrentUserAction } from '@/features/auth'
import {
  bootSeedSuppressedAtom,
  loadNotebook,
  markBootRestored,
  reconcileBootFromServer,
  startNotebookListSync,
  startSlot,
} from '@/features/notebook'
import { startNotebookListCrossTabSync } from '@/features/notebook/model/notebookListCrossTab'
import {
  AVAILABLE_MODELS,
  autoLoadModelAtom,
  loadModelAction,
  modelIdAtom,
  normalizeWebLlmPersistedState,
  reconcileDownloadedModelsAction,
} from '@/features/web-llm'
import { handleSessionExpired } from './sessionExpiry'
import { startCodeGeneratorBridge } from '@/pages/notebook/model/codeGeneratorBridge'

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
// Keys come from the single source in `entities/session` so they cannot drift.
rootFrame.run(() => {
  const token = readPersistRecord<string>(SESSION_STORAGE_KEYS.accessToken)
  const refresh = readPersistRecord<string>(SESSION_STORAGE_KEYS.refreshToken)
  const user = readPersistRecord<SessionUser>(SESSION_STORAGE_KEYS.user)
  if (token !== null) accessTokenAtom.set(token)
  if (refresh !== null) refreshTokenAtom.set(refresh)
  if (user !== null) userAtom.set(user)
})

// ---------------------------------------------------------------------------
// HTTP client wiring
// ---------------------------------------------------------------------------

// Wire the API client's auth token source. Read the access token straight from
// localStorage, NOT via accessTokenAtom(): the same reason `getRefreshToken`
// does (below). The 401 refresh-retry in `refreshMiddleware` calls this getter
// from a DETACHED async continuation after `await refreshOnce()`, where the
// Reatom frame is off the stack — a cold-atom read there throws
// `ReatomError: missing async stack` under production `clearStack()`, aborting
// the retry so a create/patch fails with "request failed" right after a 401.
// `onTokensRefreshed` writes the fresh token through `rootFrame.run` with
// withLocalStorage(subscribe:false), so localStorage holds the rotated token
// before the retry reads it here (TARDIS-167 №19/№23 follow-up).
setAuthTokenGetter(() => readPersistRecord<string>(SESSION_STORAGE_KEYS.accessToken))

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
  getRefreshToken: () => readPersistRecord<string>(SESSION_STORAGE_KEYS.refreshToken),
  onTokensRefreshed: (accessToken, refreshToken) => {
    // Persist + update atoms in a guaranteed Reatom frame so the rotated
    // refresh token is in localStorage before the retried request reads it.
    rootFrame.run(() => {
      accessTokenAtom.set(accessToken)
      refreshTokenAtom.set(refreshToken)
    })
  },
  // Pause background sync + clear the session (no local wipe — INV-4), then
  // redirect. Extracted to `sessionExpiry.ts` so this auth↔sync seam is testable.
  onSessionExpired: handleSessionExpired,
})

// Restore session if a token was persisted from a previous run.
// Notebook boot awaits this promise before resolving the per-user feature-demo id;
// otherwise the legacy floor id can leak into autosave/remoteSync as a real id.
const currentUserLoaded = rootFrame.run(() => loadCurrentUserAction())

// Keep <html> in sync with the resolved theme for the whole app lifetime.
// The subscription makes `resolvedThemeAtom` hot (so it recomputes on every
// mode switch or OS flip on ANY route, not only where NotebookView is
// mounted), and fires synchronously on subscribe to cover the first paint.
rootFrame.run(() => {
  startThemeSync()
  startCodeGeneratorBridge()
  // Refetch the sidebar notebook list when the signed-in account changes within
  // one session, and clear it on sign-out (#135) — the list resource does not
  // track the user itself, so a stale/foreign list would otherwise linger.
  startNotebookListSync()
  // TARDIS-167 (review PR #88 r3): sanitise localStorage-restored model state
  // (drop garbage/stale ids, reset a phantom selected id) SYNCHRONOUSLY before
  // any component reads it — otherwise `new Set(downloadedModelIdsAtom())` could
  // throw on a corrupt record and crash the page render.
  normalizeWebLlmPersistedState()
  // TARDIS-167 (№5, review PR #88): drop persisted "downloaded" model ids whose
  // WebLLM cache was cleared/evicted, so the list highlight reflects the real
  // cache. Best-effort and self-contained — never blocks boot.
  void reconcileDownloadedModelsAction()
  // TARDIS-181: auto-load the default model on start when the user opted in via
  // Settings. Runs AFTER normalization so the flag + selected id are already
  // sanitised. Gated on a valid catalogue id; best-effort (the action owns its
  // own progress/error state and a sequence guard) — never blocks boot.
  if (autoLoadModelAtom() && AVAILABLE_MODELS.includes(modelIdAtom())) {
    void loadModelAction()
  }
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
  let bootedNotebook = false
  try {
    await wrap(currentUserLoaded)
    // The feature-demo id is derived from user.id. On the login page there is no
    // user yet, so starting the notebook slot would bind autosave/remoteSync to
    // the legacy floor id. The userAtom subscription in startNotebookListSync boots
    // the slot after sign-in. Gate on the single derived auth status (anything but
    // 'authenticated' — anonymous or a still-pending restore — skips slot boot).
    if (authStatusAtom() !== 'authenticated') return
    // Server-reconcile BEFORE loading the slot (TARDIS-167 №23 bootstrap step 4b):
    // when local storage is empty (fresh device), pull the account's newest
    // notebook into IndexedDB and tombstone the seed if it was deleted elsewhere,
    // so `loadNotebook(true)` then opens the right notebook instead of reseeding.
    // Best-effort and self-contained — never blocks boot.
    await wrap(reconcileBootFromServer())
    // A real restore (existing stored notebook) surfaces "Saved · <time>" right
    // away, seeded from the stored timestamp — instead of a blank indicator
    // until the first edit. A fresh seed / newer-format / failure returns false
    // and keeps the idle state.
    // Boot picks the newest locally-stored notebook for the slot (TARDIS-167 №23
    // bootstrap step 3); only this boot caller passes `true`.
    const restored = await wrap(loadNotebook(true))
    bootedNotebook = true
    if (restored) markBootRestored()
    // Review #3 (TARDIS-167 №23): the user deleted their seed and has no other
    // notebook, so `loadNotebook` opened nothing real and left the slot on the
    // inert legacy floor (autosave/remote-sync stay unbound). Send them to the
    // Usage page's Restore affordance instead of an unbacked, unsaveable seed
    // whose first edit would resurrect the deleted seed. SPA navigation (no
    // reload), so boot does not re-run and loop.
    if (bootSeedSuppressedAtom()) {
      urlAtom.set((url) => new URL(appPath('usage'), url.origin), true)
    }
  } finally {
    if (bootedNotebook) {
      // Start the editor slot for the boot notebook: autosave + background
      // remote-sync (#134, self-guards on auth) + optional persisted AI context
      // (Mode B), all bound to the active slot id (#135). The slot controller owns
      // these bindings so open-into-slot can safely switch them to another id.
      // When the seed was suppressed (review #3) the active id is the legacy
      // floor, so `startBindings` self-refuses to arm — harmless, kept for symmetry.
      startSlot()
    }
  }
})

// ---------------------------------------------------------------------------
// Multi-tab sync
// ---------------------------------------------------------------------------

// withLocalStorage(subscribe:false) does not register storage event listeners,
// so cross-tab session propagation is wired in ONE echo-safe place (see
// `entities/session/model/crossTabSync.ts`). The previous inline handler here
// re-`set` persisted atoms on every event, which re-wrote localStorage with a
// fresh record id/timestamp and bounced the event back to the other tab — an
// infinite ping-pong that flickered the UI between login and the signed-in view
// in both tabs on logout. `startSessionCrossTabSync` applies an incoming value
// only when it differs by value, so the echo dies after one hop.
startSessionCrossTabSync()

// Mirror the lightweight notebook LIST (ids + titles) across tabs too, so a
// notebook created in one tab shows up in the sidebar of the others without a
// reload (#136 will own full device-mode sync; this is just the list). Same
// echo-safe localStorage shape as the session sync.
startNotebookListCrossTabSync()
