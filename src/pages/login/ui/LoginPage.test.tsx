import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { clearSession, setSession } from '@/entities/session'
import LoginPage from './LoginPage'

const stubUser = { id: 'u1', email: 'a@b.com', roles: [] }
const stubSession = { accessToken: 'tok', refreshToken: 'ref', user: stubUser }

let replaceSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  clearSession()
  replaceSpy = vi.fn()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LoginPage', () => {
  test('authenticated with no ?from: redirects to /', () => {
    vi.stubGlobal('location', {
      replace: replaceSpy,
      pathname: '/login',
      href: 'http://localhost/login',
      search: '',
      origin: 'http://localhost',
    })
    setSession(stubSession)
    render(<LoginPage />)
    expect(replaceSpy).toHaveBeenCalledWith('/')
  })

  test('authenticated with valid ?from: redirects to that path', () => {
    vi.stubGlobal('location', {
      replace: replaceSpy,
      pathname: '/login',
      href: 'http://localhost/login?from=%2Fnotebooks',
      search: '?from=%2Fnotebooks',
      origin: 'http://localhost',
    })
    setSession(stubSession)
    render(<LoginPage />)
    expect(replaceSpy).toHaveBeenCalledWith('/notebooks')
  })

  test('authenticated with open-redirect attempt: falls back to /', () => {
    vi.stubGlobal('location', {
      replace: replaceSpy,
      pathname: '/login',
      href: 'http://localhost/login?from=%2F%2Fevil.com',
      search: '?from=%2F%2Fevil.com',
      origin: 'http://localhost',
    })
    setSession(stubSession)
    render(<LoginPage />)
    // //evil.com starts with // — should be rejected and fall back to /
    expect(replaceSpy).toHaveBeenCalledWith('/')
  })

  test('unauthenticated: renders login form without redirecting', () => {
    vi.stubGlobal('location', {
      replace: replaceSpy,
      pathname: '/login',
      href: 'http://localhost/login',
      search: '',
      origin: 'http://localhost',
    })
    render(<LoginPage />)
    expect(replaceSpy).not.toHaveBeenCalled()
    // LoginForm renders the passwordless lede on step 1
    expect(
      screen.getByText("Passwordless. Enter your email and we'll send a one-time code."),
    ).toBeInTheDocument()
  })
})
