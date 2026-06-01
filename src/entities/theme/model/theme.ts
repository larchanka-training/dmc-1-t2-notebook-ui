import { atom, computed, reatomMediaQuery, withLocalStorage } from '@reatom/core'

// The user picks a MODE; the resolved THEME is what actually gets applied.
// Default mode is `system`, which follows the OS preference and reacts to it
// changing live (e.g. macOS auto dark at night).
export type Theme = 'light' | 'dark'
export type ThemeMode = 'light' | 'dark' | 'system'

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

// Live OS preference; reatomMediaQuery wires up the matchMedia listener and
// updates reactively when the system theme flips.
const systemDarkAtom = reatomMediaQuery('(prefers-color-scheme: dark)')

/** The user-chosen mode. Persisted; defaults to `system`. */
export const themeModeAtom = atom<ThemeMode>('system', 'theme.mode').extend(
  withLocalStorage('theme-mode'),
)

/**
 * The theme actually in effect after resolving `system` against the OS.
 * Pure derivation only — the DOM side effect lives in `startThemeSync`, which
 * subscribes to this atom so it stays connected (and therefore recomputes)
 * regardless of which page is mounted.
 */
export const resolvedThemeAtom = computed<Theme>(() => {
  const mode = themeModeAtom()
  if (mode === 'system') return systemDarkAtom() ? 'dark' : 'light'
  return mode
}, 'theme.resolved')

/**
 * Keep <html> in sync with the resolved theme for the lifetime of the app.
 *
 * Why a subscription rather than `withChangeHook`: `resolvedThemeAtom` is a
 * lazy `computed`. A change hook only fires when the atom RECOMPUTES, and a
 * computed only recomputes while it has a live subscriber. Previously the only
 * subscriber was NotebookView, so on routes without it (e.g. /about) toggling
 * the theme updated `themeModeAtom` but never re-ran the hook — the document
 * stayed on the old theme. An always-on subscription started at app init makes
 * the atom hot everywhere, and the callback fires synchronously on subscribe
 * (so it also covers the initial paint). Returns the unsubscribe handle.
 */
export function startThemeSync(): () => void {
  return resolvedThemeAtom.subscribe(applyTheme)
}
