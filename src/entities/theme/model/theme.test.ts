import { describe, expect, test } from 'vitest'
import { resolvedThemeAtom, themeModeAtom } from './theme'

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
