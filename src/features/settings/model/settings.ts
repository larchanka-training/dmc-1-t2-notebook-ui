import { atom, computed, withLocalStorage } from '@reatom/core'
import { userAtom } from '@/entities/session'

// Device-local user settings (TARDIS-181, in-browser only). Persisted to
// localStorage via Reatom — read reactively from components, so plain
// `withLocalStorage` is enough (same pattern as themeModeAtom).

/**
 * Display name shown in the sidebar. A purely local override: the server's
 * `User.displayName` is read-only (no write endpoint, `null` in prod), so the
 * editable name lives here. Empty string means "unset" → fall back to email.
 */
export const displayNameAtom = atom('', 'settings.displayName').extend(
  withLocalStorage('settings.displayName'),
)

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
