import { computed, withAsyncData, wrap } from '@reatom/core'
import {
  activeNotebookIdAtom,
  listOwnedLocalNotebooks,
  notebookListResource,
  notebookTitleAtom,
} from '@/features/notebook'

// Dashboard card model (TARDIS-183). One card per notebook the user can open.
// Metadata is optional: the server list always carries it, a local-only seed
// carries it from IndexedDB, and the synthetic floor row may have only a title.
export interface DashboardCard {
  id: string
  title: string
  /** ms since epoch; absent for the synthetic floor row. */
  createdAt?: number
  /** ms since epoch; absent for the synthetic floor row. */
  updatedAt?: number
  /** Cell count; absent for the synthetic floor row. */
  cellsCount?: number
}

const FLOOR_TITLE_FALLBACK = 'Untitled notebook'

/**
 * The notebooks shown on the dashboard: the server list merged with the user's
 * owned local notebooks, deduplicated by `id` (server wins), plus a single
 * synthetic "floor" card for the active notebook when it is in neither list
 * (the local welcome seed before its first sync — TARDIS-183 keeps a brand-new
 * user's dashboard from looking empty).
 *
 * Sources & guardrails:
 *   • Server rows come from `notebookListResource.data()`. Reading it makes the
 *     resource hot, so the dashboard page must gate this read behind the
 *     signed-in user (G1) and add no extra `.retry()` (G2) — the sidebar is the
 *     single fetcher. (See `notebookList.ts` guardrails.)
 *   • Offline is handled implicitly: when the GET fails, `data()` stays at its
 *     `[]` init state, so the merge degrades to owned-local rows only — exactly
 *     the offline behaviour the issue requires (acceptance 6).
 *   • Ownership for local rows is the provable set (`listOwnedLocalNotebooks`),
 *     never another account's notebooks on a shared device (§11).
 *
 * Ordered newest-first by `createdAt` (matching the sidebar); the floor row,
 * which has no `createdAt`, sorts last.
 */
export const dashboardNotebooksResource = computed(async () => {
  // Subscribe to the server list (hot — gated by the page's auth check).
  const serverRows = notebookListResource.data()
  // Provably-owned local notebooks (seed + sync-state-owned), async storage read.
  const owned = await wrap(listOwnedLocalNotebooks())

  const byId = new Map<string, DashboardCard>()
  for (const row of serverRows) {
    byId.set(row.id, {
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      cellsCount: row.cellsCount,
    })
  }
  // Local-only rows (not yet on the server, e.g. a fresh seed): add if absent.
  for (const nb of owned) {
    if (byId.has(nb.id)) continue
    byId.set(nb.id, {
      id: nb.id,
      title: nb.title,
      createdAt: nb.createdAt,
      updatedAt: nb.updatedAt,
      cellsCount: nb.cells.length,
    })
  }
  // Synthetic floor card: the active notebook is in neither list (the unsynced
  // welcome seed). Mirror `effectiveNotebookCount`'s floor rule, but dedupe
  // strictly by id so a seed already merged above is never doubled.
  const activeId = activeNotebookIdAtom()
  if (!byId.has(activeId)) {
    byId.set(activeId, { id: activeId, title: notebookTitleAtom() || FLOOR_TITLE_FALLBACK })
  }

  // createdAt desc; rows without createdAt (the floor) sort last.
  return [...byId.values()].sort((a, b) => {
    if (a.createdAt === undefined) return 1
    if (b.createdAt === undefined) return -1
    return b.createdAt - a.createdAt || b.id.localeCompare(a.id)
  })
}, 'dashboard.notebooks').extend(withAsyncData({ initState: [] as DashboardCard[] }))
