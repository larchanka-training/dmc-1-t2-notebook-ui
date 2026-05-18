import { atom, withChangeHook, withLocalStorage } from '@reatom/core'

export type Theme = 'light' | 'dark'

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export const themeAtom = atom<Theme>('light', 'theme').extend(
  withLocalStorage('theme'),
  withChangeHook(applyTheme),
)
