// Boot server-reconcile (TARDIS-167 №23, bootstrap step 4b).
//
// Runs ONLY when IndexedDB has no notebooks for the signed-in user (a fresh
// device / cleared storage). It asks the server what the account actually has
// and reconciles local state BEFORE the slot loads, so an existing user landing
// on a new device opens their newest notebook — and a user who previously
// deleted their seed does not get it resurrected here.
//
// Decision table (local is empty):
//   • list() throws (offline / API down) → do nothing; loadNotebook seeds.
//   • empty list (brand-new user)        → do nothing; loadNotebook seeds.
//   • non-empty list (existing user on a new device):
//       – the per-user seed id IS in the list  → seed was never deleted; pull the
//         newest notebook into storage so the slot opens it.
//       – the per-user seed id is NOT in the list → seed was deleted on another
//         device; tombstone it locally (so loadNotebook won't reseed) and pull
//         the newest remaining notebook into storage.
//
// This module owns the NETWORK + tombstone side of boot; `loadNotebook` stays
// storage-only and simply opens whatever this left in IndexedDB (the newest
// local notebook via `pickNewest`). Keeping the network here also avoids a
// notebook ↔ pull import cycle.

import { wrap } from '@reatom/core'
import { notebook as notebookApi } from '@/shared/api'
import { notebookStorage } from '../persistence/activeStorage'
import { resolveDemoNotebookId } from './notebook'
import { pullServerNotebook } from './pull'
import { setSeedTombstone } from './seedTombstone'

/** Outcome of the boot reconcile, for logging/tests. */
export type BootReconcileOutcome =
  // Local already had notebooks — reconcile skipped entirely.
  | 'skipped-local-present'
  // The server list could not be fetched (offline / error) — seed path will run.
  | 'unavailable'
  // The account has no notebooks server-side (new user) — seed path will run.
  | 'empty'
  // Existing user; the newest server notebook was pulled into local storage.
  | 'reconciled'
  // Existing user whose seed was deleted elsewhere; tombstoned + pulled newest.
  | 'reconciled-seed-deleted'

/**
 * Reconcile local storage against the server when local is empty (see file
 * header). Best-effort: any failure resolves to a no-op outcome so boot falls
 * back to the seed path. Returns the outcome for observability/tests.
 */
export async function reconcileBootFromServer(): Promise<BootReconcileOutcome> {
  // Only act on an empty local store; a present local notebook is authoritative
  // for the slot choice (bootstrap step 3) and must not trigger a network pull.
  const local = await wrap(notebookStorage.list())
  if (local.length > 0) return 'skipped-local-present'

  let items: notebookApi.NotebookListItem[]
  try {
    items = await wrap(notebookApi.list())
  } catch (error) {
    // Almost impossible (the SPA just loaded over the same origin), but if the
    // list call fails we must not block boot — let loadNotebook seed.
    console.warn('boot reconcile: notebook list unavailable; falling back to seed', error)
    return 'unavailable'
  }

  // Brand-new account: nothing to reconcile, the seed path is correct.
  if (items.length === 0) return 'empty'

  // Existing user on a new device. Decide the seed fate from whether its
  // deterministic id is present, THEN pull the newest notebook into storage so
  // the slot (loadNotebook with pickNewest) opens it.
  let seedDeleted = false
  try {
    const demoId = await wrap(resolveDemoNotebookId())
    seedDeleted = !items.some((it) => it.id === demoId)
  } catch (error) {
    // Cannot resolve the per-user id (e.g. not hydrated) — treat the seed as not
    // deleted; we still pull the newest notebook below.
    console.warn('boot reconcile: could not resolve the seed id; skipping tombstone', error)
  }

  if (seedDeleted) {
    try {
      await wrap(setSeedTombstone())
    } catch (error) {
      console.warn('boot reconcile: failed to record the seed tombstone', error)
    }
  }

  // The list is server-sorted `createdAt desc`, so items[0] is the newest. Fetch
  // its full document and write it locally (honouring the pull conflict rule).
  const newest = items[0]
  try {
    const full = await wrap(notebookApi.get(newest.id))
    await wrap(pullServerNotebook(full))
  } catch (error) {
    // A failed pull is not fatal: loadNotebook will seed, and the regular
    // open-into-slot / list flow can fetch it later.
    console.warn('boot reconcile: failed to pull the newest notebook; seeding', error)
  }

  return seedDeleted ? 'reconciled-seed-deleted' : 'reconciled'
}
