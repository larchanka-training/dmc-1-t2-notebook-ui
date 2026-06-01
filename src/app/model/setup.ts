import { connectLogger, log } from '@reatom/core'
import { rootFrame } from '@/setup'
import { setAuthTokenGetter } from '@/shared/api'
import { tokenAtom } from '@/entities/session'
import { startThemeSync } from '@/entities/theme'
import { loadCurrentUserAction } from '@/features/auth'

if (import.meta.env.MODE === 'development') {
  connectLogger()
}

declare global {
  var LOG: typeof log
}

globalThis.LOG = log

// Wire the API client's auth token source to the auth atom.
// This composition lives here so `shared/api` stays framework-agnostic.
setAuthTokenGetter(() => tokenAtom())

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
