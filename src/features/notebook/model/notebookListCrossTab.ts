// Cross-tab propagation of the lightweight notebook LIST (ids + titles, no cells).
//
// Until the device-mode work (#136) the editor saves unconditionally, so a
// notebook created in one tab is already in IndexedDB; but the sidebar list lives
// in `notebookListResource.data`, an in-memory atom that another tab never hears
// about. This mirrors that list across tabs of the same origin through a single
// localStorage key, the same echo-safe shape used for the session
// (`entities/session/model/crossTabSync.ts`).
//
// Two sides, both echo-safe by VALUE so a write never bounces back forever:
//   - WRITER: a `withChangeHook` on `notebookListResource.data` writes the rows
//     to localStorage whenever they change locally (create, delete, retry result,
//     boot fetch). `withChangeHook` is middleware — it fires on a real change and
//     does NOT subscribe to / connect the resource, so it can't trigger a
//     spurious GET /notebooks (the trap that caused the earlier 401 storm). The
//     write is skipped when the stored value already equals the new one.
//   - READER: a `storage` listener applies an incoming list to the resource. It
//     compares via `peek` (reading `data()` directly would recompute the computed
//     and fire a fetch) and skips equal values, so applying a remote update does
//     not loop back into another write/event.
//
// The payload is stamped with the owner id and ignored cross-account: two tabs
// are normally converged to one account by the session sync, but this is a hard
// guard against ever surfacing one account's list under another.

import { addChangeHook, isDeepEqual, log, peek } from '@reatom/core'
import { rootFrame } from '@/setup'
import { userAtom } from '@/entities/session'
import { notebook as notebookApi } from '@/shared/api'
import { notebookListResource } from './notebookList'

const STORAGE_KEY = 'notebook.list.crosstab'

interface ListBroadcast {
  ownerId: string
  items: notebookApi.NotebookListItem[]
}

function parseBroadcast(raw: string | null): ListBroadcast | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ListBroadcast
    if (typeof parsed?.ownerId !== 'string' || !Array.isArray(parsed.items)) return null
    return parsed
  } catch {
    return null
  }
}

/** WRITER: persist the current rows for cross-tab readers, owner-stamped and
 * skipped when unchanged (so applying a remote update does not re-broadcast). */
function broadcastList(items: notebookApi.NotebookListItem[]): void {
  const ownerId = userAtom()?.id
  if (!ownerId) return
  const existing = parseBroadcast(localStorage.getItem(STORAGE_KEY))
  if (existing && existing.ownerId === ownerId && isDeepEqual(existing.items, items)) return
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ownerId, items } satisfies ListBroadcast))
  log(`📒 notebook.list BROADCAST → localStorage :: ${items.length} rows`)
}

/**
 * Start cross-tab list sync. Attaches the writer change-hook and the reader
 * storage listener. Returns an unsubscribe handle that removes BOTH — the writer
 * via `addChangeHook`'s returned remover and the storage listener — so
 * `start`/`stop` are symmetric and idempotent (a repeated `start` after `stop`
 * does not accumulate duplicate broadcasters).
 */
export function startNotebookListCrossTabSync(): () => void {
  const removeWriter = addChangeHook(notebookListResource.data, (items) => broadcastList(items))

  const handler = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return
    const payload = parseBroadcast(e.newValue)
    if (!payload) return
    rootFrame.run(() => {
      // Cross-account guard: never surface another account's list.
      if (payload.ownerId !== userAtom()?.id) return
      // `peek` reads the cached rows WITHOUT recomputing the resource (a plain
      // `data()` read would pull the computed and fire GET /notebooks).
      if (isDeepEqual(peek(notebookListResource.data), payload.items)) return
      notebookListResource.data.set(payload.items)
      log(`📒 notebook.list APPLY ← localStorage (another tab) :: ${payload.items.length} rows`)
    })
  }
  window.addEventListener('storage', handler)
  return () => {
    removeWriter()
    window.removeEventListener('storage', handler)
  }
}
