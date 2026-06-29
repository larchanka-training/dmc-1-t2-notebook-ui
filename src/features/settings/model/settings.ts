import { atom, computed } from '@reatom/core'
import { userAtom } from '@/entities/session'

// Per-user settings (TARDIS-181, in-browser only). These are namespaced by
// `user.id` (see `userSettings.ts` + `settingsSync.ts`): a plain in-memory atom
// hydrated/persisted under `settings:<userId>`, NOT self-persisted — so two
// accounts on the same browser never see each other's values.

/**
 * Display name shown in the sidebar. A purely local override: the server's
 * `User.displayName` is read-only (no write endpoint, `null` in prod), so the
 * editable name lives here. Empty string means "unset" → fall back to email.
 */
export const displayNameAtom = atom('', 'settings.displayName')

/**
 * The name to render for the signed-in user: the local display name when set,
 * otherwise the account email, otherwise a neutral last resort. The server
 * `displayName` is intentionally not consulted (read-only, prod-null).
 */
export const sidebarDisplayNameAtom = computed(() => {
  const local = displayNameAtom().trim()
  if (local) return local
  return userAtom()?.email ?? 'Account'
}, 'settings.sidebarDisplayName')
