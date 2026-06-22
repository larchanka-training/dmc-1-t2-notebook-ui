// Deleted-seed tombstone (TARDIS-167 №23, contract A).
//
// Once the user deletes their welcome/feature-demo notebook, boot must NOT
// resurrect it. We persist a durable per-account marker in the storage `meta`
// partition; boot consults it before seeding, and Restore (usage page) clears
// it. Stored per owner id so a shared device does not leak one account's
// "I deleted the seed" decision onto another account.

import { notebookStorage } from '../persistence/activeStorage'
import { userAtom } from '@/entities/session'

// Key is namespaced by owner id: the deletion decision is per account, and the
// meta partition is shared by all accounts on the device.
function tombstoneKey(ownerId: string): string {
  return `seed-tombstone:${ownerId.toLowerCase()}`
}

/**
 * Whether the current user has deleted their seed (so boot must not recreate
 * it). Returns `false` when signed out or when no marker is stored.
 */
export async function isSeedTombstoned(): Promise<boolean> {
  const ownerId = userAtom()?.id
  if (!ownerId) return false
  return (await notebookStorage.getMeta(tombstoneKey(ownerId))) === true
}

/** Record that the current user's seed was deleted (durable across boots). */
export async function setSeedTombstone(): Promise<void> {
  const ownerId = userAtom()?.id
  if (!ownerId) return
  await notebookStorage.putMeta(tombstoneKey(ownerId), true)
}

/** Clear the deleted-seed marker (Restore demo), so the seed can exist again. */
export async function clearSeedTombstone(): Promise<void> {
  const ownerId = userAtom()?.id
  if (!ownerId) return
  await notebookStorage.deleteMeta(tombstoneKey(ownerId))
}
