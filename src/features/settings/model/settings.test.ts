import { afterEach, describe, expect, test } from 'vitest'
import { peek } from '@reatom/core'
import { userAtom } from '@/entities/session'
import { displayNameAtom, sidebarDisplayNameAtom } from './settings'

afterEach(() => {
  userAtom.set(null)
  displayNameAtom.set('')
})

describe('displayNameAtom (TARDIS-181 device-local display name)', () => {
  test('defaults to an empty string', () => {
    expect(peek(displayNameAtom)).toBe('')
  })

  test('a set value is readable back via peek', () => {
    displayNameAtom.set('Лора')
    expect(peek(displayNameAtom)).toBe('Лора')
  })

  // Persistence is no longer self-contained on the atom: it is namespaced per
  // user by the settings sync layer (see userSettings.test.ts / settingsSync).
})

describe('sidebarDisplayNameAtom (computed fallback chain)', () => {
  test('returns the trimmed local name when set', () => {
    displayNameAtom.set('  Лора  ')
    expect(peek(sidebarDisplayNameAtom)).toBe('Лора')
  })

  test('falls back to the account email when the local name is whitespace-only', () => {
    displayNameAtom.set('   ')
    userAtom.set({ id: 'x', email: 'a@b.c', roles: [] })
    expect(peek(sidebarDisplayNameAtom)).toBe('a@b.c')
  })

  test('falls back to the account email when the local name is empty', () => {
    displayNameAtom.set('')
    userAtom.set({ id: 'x', email: 'a@b.c', roles: [] })
    expect(peek(sidebarDisplayNameAtom)).toBe('a@b.c')
  })

  test("falls back to 'Account' when both local name and user are absent", () => {
    displayNameAtom.set('')
    userAtom.set(null)
    expect(peek(sidebarDisplayNameAtom)).toBe('Account')
  })

  test('prefers the local name over the account email when both are present', () => {
    displayNameAtom.set('Лора')
    userAtom.set({ id: 'x', email: 'a@b.c', roles: [] })
    expect(peek(sidebarDisplayNameAtom)).toBe('Лора')
  })
})
