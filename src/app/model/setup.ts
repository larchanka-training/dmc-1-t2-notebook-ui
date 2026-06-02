import { connectLogger, log, wrap } from '@reatom/core'
import { rootFrame } from '@/setup'
import { setAuthTokenGetter } from '@/shared/api'
import { tokenAtom } from '@/entities/session'
import { startThemeSync } from '@/entities/theme'
import { loadCurrentUserAction } from '@/features/auth'
import { loadNotebook, startAutosave } from '@/features/notebook'

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
    await wrap(loadNotebook())
  } finally {
    startAutosave()
  }
})
