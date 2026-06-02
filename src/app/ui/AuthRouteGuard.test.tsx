import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { accessTokenAtom, clearSession, sessionRestoredAtom, setSession } from '@/entities/session'
import { AuthRouteGuard } from './AuthRouteGuard'

const stubUser = { id: 'u1', email: 'a@b.com', roles: [] }
const stubSession = { accessToken: 'tok', refreshToken: 'ref', user: stubUser }

let replaceSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  clearSession()
  replaceSpy = vi.fn()
  vi.stubGlobal('location', {
    replace: replaceSpy,
    pathname: '/protected',
    href: 'http://localhost/protected',
    search: '',
    origin: 'http://localhost',
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AuthRouteGuard', () => {
  test('unauthenticated (session restored): redirects to /login?from=<pathname>', () => {
    sessionRestoredAtom.set(true)
    render(
      <AuthRouteGuard>
        <div>secret</div>
      </AuthRouteGuard>,
    )
    expect(replaceSpy).toHaveBeenCalledWith('/login?from=%2Fprotected')
    expect(screen.queryByText('secret')).toBeNull()
  })

  test('authenticated: renders children without redirecting', () => {
    setSession(stubSession)
    sessionRestoredAtom.set(true)
    render(
      <AuthRouteGuard>
        <div>secret</div>
      </AuthRouteGuard>,
    )
    expect(screen.getByText('secret')).toBeInTheDocument()
    expect(replaceSpy).not.toHaveBeenCalled()
  })

  test('token present but session not yet restored: renders null and does not redirect', () => {
    // Simulates the window between page load and loadCurrentUserAction completing.
    // Token is in localStorage but /auth/me hasn't resolved yet.
    accessTokenAtom.set('tok')
    // userAtom = null, sessionRestoredAtom = false → isPendingRestore
    render(
      <AuthRouteGuard>
        <div>secret</div>
      </AuthRouteGuard>,
    )
    expect(screen.queryByText('secret')).toBeNull()
    expect(replaceSpy).not.toHaveBeenCalled()
  })

  test('session restored but no tokens (expired session): redirects to /login', () => {
    // Simulates loadCurrentUserAction completing with a 401 → clearSession() ran
    sessionRestoredAtom.set(true)
    // accessTokenAtom = null (cleared), userAtom = null
    render(
      <AuthRouteGuard>
        <div>secret</div>
      </AuthRouteGuard>,
    )
    expect(replaceSpy).toHaveBeenCalledWith('/login?from=%2Fprotected')
  })
})
