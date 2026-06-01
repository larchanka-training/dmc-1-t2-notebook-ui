import { afterEach, describe, expect, test } from 'vitest'
import { resolvedThemeAtom, startThemeSync, themeModeAtom } from './theme'

describe('theme mode resolution', () => {
  test('defaults to system mode', () => {
    expect(themeModeAtom()).toBe('system')
  })

  test('explicit light/dark modes resolve to themselves', () => {
    themeModeAtom.set('light')
    expect(resolvedThemeAtom()).toBe('light')
    themeModeAtom.set('dark')
    expect(resolvedThemeAtom()).toBe('dark')
  })

  test('system mode resolves against the OS preference (light in tests)', () => {
    // The test setup stubs matchMedia as non-matching → system means light.
    themeModeAtom.set('system')
    expect(resolvedThemeAtom()).toBe('light')
  })
})

describe('startThemeSync (global DOM application)', () => {
  afterEach(() => {
    document.documentElement.classList.remove('dark')
  })

  test('applies the current theme synchronously on subscribe', () => {
    themeModeAtom.set('dark')
    const stop = startThemeSync()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    stop()
  })

  // Regression: toggling the theme must update <html> even when nothing else
  // subscribes to resolvedThemeAtom (e.g. on /about, where NotebookView — the
  // former sole subscriber — is not mounted). The subscription keeps the lazy
  // computed hot so the change actually recomputes and re-applies. Reatom
  // notifies subscribers on a microtask after a `.set`, so we tick between
  // assertions (this mirrors the one-frame async apply in the real app).
  test('toggles <html> both ways with no other subscriber mounted', async () => {
    const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
    themeModeAtom.set('dark')
    const stop = startThemeSync()
    // Initial apply on subscribe is synchronous.
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    themeModeAtom.set('light')
    await tick()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    themeModeAtom.set('dark')
    await tick()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    stop()
  })
})
