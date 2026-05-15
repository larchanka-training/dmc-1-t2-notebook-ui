import { connectLogger, log } from '@reatom/core'
import { rootFrame } from '@/setup'
import { setAuthTokenGetter } from '@/shared/api'
import { tokenAtom } from '@/entities/session'
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
