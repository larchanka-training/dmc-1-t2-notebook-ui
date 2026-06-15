// Browser connectivity signal for the remote autosync layer (#134).
//
// `isOnlineAtom` mirrors `navigator.onLine`, kept current by the window
// online/offline events. The sync engine reads it to avoid firing a push it
// knows will fail offline, and re-attempts the queued changes on the `online`
// event. It is advisory only — `navigator.onLine` reports the network interface,
// not real reachability — so a push may still fail with a NetworkError while
// "online"; that path keeps the queue and retries regardless.

import { atom, wrap } from '@reatom/core'

/**
 * Whether the browser currently reports network connectivity. Seeded from
 * `navigator.onLine`; defaults to online where there is no navigator (non-DOM
 * runtimes) — assuming offline there would needlessly stall the sync layer.
 */
export const isOnlineAtom = atom(
  typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
    ? navigator.onLine
    : true,
  'notebook.isOnline',
)

/**
 * Mirror the window `online`/`offline` events into `isOnlineAtom` for the app's
 * lifetime. Returns an unsubscribe; a no-op (and no-op teardown) when there is no
 * window. Handlers are `wrap`-captured because the events fire from a fresh async
 * boundary, where `clearStack()` requires an explicit stack to touch atoms.
 */
export function startOnlineTracking(): () => void {
  if (typeof window === 'undefined') return () => {}

  const onOnline = wrap(() => isOnlineAtom.set(true))
  const onOffline = wrap(() => isOnlineAtom.set(false))
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  return () => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
  }
}
