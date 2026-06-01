import { atom, computed, reatomMediaQuery, withChangeHook, withLocalStorage } from '@reatom/core'

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
 * `withChangeHook` keeps <html> in sync on every change (mode switch or OS
 * flip). The initial paint is applied imperatively in app/model/setup.ts,
 * since the hook only fires on changes.
 */
export const resolvedThemeAtom = computed<Theme>(() => {
  const mode = themeModeAtom()
  if (mode === 'system') return systemDarkAtom() ? 'dark' : 'light'
  return mode
}, 'theme.resolved').extend(withChangeHook(applyTheme))

export function applyResolvedTheme(): void {
  applyTheme(resolvedThemeAtom())
}
