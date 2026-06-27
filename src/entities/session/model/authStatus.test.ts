import { afterEach, describe, expect, test } from 'vitest'
import { accessTokenAtom, refreshTokenAtom, userAtom, sessionRestoredAtom } from './session'
import { authStatusAtom } from './authStatus'

const USER = { id: 'u1', email: 'a@b.com', displayName: null, roles: [] }

afterEach(() => {
  accessTokenAtom.set(null)
  refreshTokenAtom.set(null)
  userAtom.set(null)
  sessionRestoredAtom.set(false)
})

describe('authStatusAtom', () => {
  test('authenticated when both token and user are present', () => {
    accessTokenAtom.set('tok')
    userAtom.set(USER)
    expect(authStatusAtom()).toBe('authenticated')
  })

  test('pending while a token is present but the user has not hydrated and restore has not settled', () => {
    accessTokenAtom.set('tok')
    userAtom.set(null)
    sessionRestoredAtom.set(false)
    expect(authStatusAtom()).toBe('pending')
  })

  test('anonymous once the restore settled with a token but no user (dead session)', () => {
    accessTokenAtom.set('tok')
    userAtom.set(null)
    sessionRestoredAtom.set(true)
    expect(authStatusAtom()).toBe('anonymous')
  })

  test('anonymous when signed out (no token)', () => {
    accessTokenAtom.set(null)
    userAtom.set(null)
    expect(authStatusAtom()).toBe('anonymous')
  })
})
